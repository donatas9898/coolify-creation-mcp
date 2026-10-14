import { applicationTypes, projectSchema, webhookSchema, uuid } from "./schemas.js";
import type {
  ApplicationType,
  ParsedApplicationConfig,
  ProjectInput,
  WebhookInput,
} from "./schemas.js";
import { z } from "zod";
import { PublicError } from "./errors.js";
import {
  applicationResponseSchema,
  creationResponseSchema,
  destinationResponseSchema,
  parseResponse,
  projectResponseSchema,
  serverResponseSchema,
} from "./api-types.js";
export { applicationSchema } from "./schemas.js";

export interface CoolifyClientOptions {
  url: string | undefined;
  token: string | undefined;
  fetchImpl?: typeof fetch;
  allowInsecureHttp?: boolean;
}

export class CoolifyClient {
  readonly origin: string;
  readonly api: string;
  readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor({ url, token, fetchImpl = fetch, allowInsecureHttp = false }: CoolifyClientOptions) {
    if (!url || !token || /[\r\n]/.test(token)) {
      throw new PublicError(
        "Configure COOLIFY_URL and COOLIFY_TOKEN in the MCP process environment.",
      );
    }
    const parsed = new URL(url);
    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !["/", "/api/v1", "/api/v1/"].includes(parsed.pathname)
    ) {
      throw new PublicError(
        "COOLIFY_URL must be an instance origin, optionally ending in /api/v1.",
      );
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (parsed.protocol === "http:" && !loopback && !allowInsecureHttp) {
      throw new PublicError(
        "Remote Coolify instances require HTTPS. Only enable COOLIFY_ALLOW_INSECURE_HTTP=true for a deliberately trusted HTTP deployment.",
      );
    }
    this.origin = parsed.origin;
    this.api = `${parsed.origin}/api/v1`;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.api}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      });
    } catch {
      throw new PublicError(
        method === "POST"
          ? "Creation response could not be confirmed. Check existing applications before retrying; the request may have succeeded."
          : "Coolify could not be reached. Check the instance URL and network access.",
      );
    }
    if (!response.ok) {
      const hints: Record<number, string> = {
        401: "Check token validity and expiration.",
        403: "Creation requires write permission and a team owner/admin; inventory requires read permission. Check API access and IP restrictions.",
        404: "The resource or API route was not found for this team.",
        409: "Resource/domain conflict. Resolve it without overriding existing domains.",
        422: "Coolify rejected the configuration. Check the project, environment, destination, image, ports, and domains.",
        429: "Coolify rate limit reached. Check inventory before retrying creation.",
      };
      throw new PublicError(
        `Coolify HTTP ${response.status}. ${
          hints[response.status] || "Request failed. Check inventory before retrying creation."
        }`,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new PublicError(
        method === "POST"
          ? "Creation may have succeeded, but the response was invalid. Check inventory before retrying."
          : "Coolify returned an invalid JSON response.",
      );
    }
  }

  webhook(applicationUuid: string) {
    uuid.parse(applicationUuid);
    return {
      url: `${this.api}/deploy?uuid=${encodeURIComponent(applicationUuid)}&force=false`,
      method: "POST",
      authorization: "Authorization: Bearer <deploy-enabled Coolify token>",
    };
  }

  async context(input: ProjectInput) {
    const { project_uuid: projectUuid } = projectSchema.parse(input);
    const [project, servers, destinations, applications] = await Promise.all([
      this.request("GET", `/projects/${projectUuid}`).then((data) =>
        parseResponse(projectResponseSchema, data, "project"),
      ),
      this.request("GET", "/servers").then((data) =>
        parseResponse(z.array(serverResponseSchema), data, "servers"),
      ),
      this.request("GET", "/destinations").then((data) =>
        parseResponse(z.array(destinationResponseSchema), data, "destinations"),
      ),
      this.request("GET", "/applications").then((data) =>
        parseResponse(z.array(applicationResponseSchema), data, "applications"),
      ),
    ]);
    return {
      inventory_scope: { servers: "team", destinations: "team", applications: "project" },
      project: {
        uuid: project.uuid,
        name: project.name,
        environments:
          project.environments?.map((item) => ({ uuid: item.uuid, name: item.name })) || [],
      },
      servers: servers.map((item) => ({ uuid: item.uuid, name: item.name })),
      destinations: destinations.map((item) => ({
        uuid: item.uuid,
        name: item.name,
        server_id: item.server_id,
        server_uuid: item.server_uuid,
        network: item.network,
      })),
      applications: applications
        .filter(
          (item) =>
            project.environments?.some(
              (environment) =>
                (environment.id !== undefined && environment.id === item.environment_id) ||
                environment.uuid === item.environment_uuid,
            ) || item.project_uuid === projectUuid,
        )
        .map((item) => ({
          uuid: item.uuid,
          name: item.name,
          build_pack: item.build_pack,
          docker_registry_image_name: item.docker_registry_image_name,
          docker_registry_image_tag: item.docker_registry_image_tag,
          ports_exposes: item.ports_exposes,
          fqdn: item.fqdn,
        })),
    };
  }

  async plan(input: unknown, type: ApplicationType = "docker_image") {
    const definition = applicationTypes[type];
    if (!definition) throw new PublicError("Unsupported application type.");
    const config: ParsedApplicationConfig = definition.schema.parse(input);
    if (config.build_pack === "dockercompose" && config.domains.length > 0) {
      throw new PublicError(
        "Docker Compose uses docker_compose_domains per service, not application domains.",
      );
    }
    if (config.build_pack !== "dockercompose" && config.docker_compose_domains) {
      throw new PublicError("docker_compose_domains requires the dockercompose build pack.");
    }
    if (type === "public_repository" && !/^https?:\/\//.test(config.git_repository || "")) {
      throw new PublicError(
        "Public repositories require an HTTP(S) URL; use a deploy key for SSH.",
      );
    }
    const [project, server, applications] = await Promise.all([
      this.request("GET", `/projects/${config.project_uuid}`).then((data) =>
        parseResponse(projectResponseSchema, data, "project"),
      ),
      this.request("GET", `/servers/${config.server_uuid}`).then((data) =>
        parseResponse(serverResponseSchema, data, "server"),
      ),
      this.request("GET", "/applications").then((data) =>
        parseResponse(z.array(applicationResponseSchema), data, "applications"),
      ),
    ]);
    const environment = project.environments?.find((item) => item.uuid === config.environment_uuid);
    if (!environment) throw new PublicError("Environment does not belong to the selected project.");
    if (server.uuid !== config.server_uuid) throw new PublicError("Server could not be verified.");
    if (config.destination_uuid) {
      const destination = parseResponse(
        destinationResponseSchema,
        await this.request("GET", `/destinations/${config.destination_uuid}`),
        "destination",
      );
      if (
        destination.server_uuid !== server.uuid &&
        !(server.id !== undefined && destination.server_id === server.id)
      ) {
        throw new PublicError("Destination does not belong to the selected server.");
      }
    }
    const existing = applications.find(
      (item) =>
        item.name === config.name &&
        (item.environment_uuid === environment.uuid ||
          (environment.id !== undefined && item.environment_id === environment.id)),
    );
    if (existing)
      throw new PublicError(
        `An application named ${config.name} already exists in this environment (${uuid.parse(existing.uuid)}). Inspect it before creating another.`,
      );
    return {
      method: "POST",
      endpoint: `${this.api}/applications/${definition.route}`,
      project: { uuid: project.uuid, name: project.name },
      environment: { uuid: environment.uuid, name: environment.name },
      body: {
        ...config,
        ...(config.dockerfile
          ? {
              dockerfile: Buffer.from(config.dockerfile, "utf8").toString("base64"),
            }
          : {}),
        ...(config.git_repository ? { is_auto_deploy_enabled: false } : {}),
        ...(config.docker_compose_domains
          ? {
              docker_compose_domains: config.docker_compose_domains.map((service) => ({
                name: service.name,
                domain: service.domains.join(","),
                redirect: service.redirect,
              })),
            }
          : {}),
        domains: config.domains.join(","),
        instant_deploy: false,
        force_domain_override: false,
      },
    };
  }

  async create(input: unknown, type: ApplicationType = "docker_image") {
    const plan = await this.plan(input, type);
    const result = await this.request(
      "POST",
      `/applications/${applicationTypes[type].route}`,
      plan.body,
    );
    const parsedResult = creationResponseSchema.safeParse(result);
    if (!parsedResult.success) {
      throw new PublicError(
        "Creation may have succeeded, but no valid UUID was returned. Check inventory before retrying.",
      );
    }
    return {
      uuid: parsedResult.data.uuid,
      name: plan.body.name,
      project: plan.project,
      environment: plan.environment,
      type,
      ...(type === "docker_image"
        ? {
            image: `${plan.body.docker_registry_image_name}:${plan.body.docker_registry_image_tag}`,
          }
        : {}),
      ...(plan.body.git_repository
        ? {
            git_repository: plan.body.git_repository,
            build_pack: plan.body.build_pack,
          }
        : {}),
      ...(type === "dockerfile"
        ? {
            requested_ports_exposes: plan.body.ports_exposes,
          }
        : { ports_exposes: plan.body.ports_exposes }),
      deployed: false,
      webhook: this.webhook(parsedResult.data.uuid),
    };
  }

  async getWebhook(input: WebhookInput) {
    const { uuid: applicationUuid } = webhookSchema.parse(input);
    const application = parseResponse(
      applicationResponseSchema,
      await this.request("GET", `/applications/${applicationUuid}`),
      "application",
    );
    if (application.uuid !== applicationUuid)
      throw new PublicError("Application could not be verified.");
    return {
      uuid: applicationUuid,
      name: application.name,
      webhook: this.webhook(applicationUuid),
    };
  }
}
