import { z } from "zod";

const uuid = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const domain = z.string().url().refine((value) => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
    !url.search && !url.hash && url.pathname === "/";
}, "Domains must be HTTP(S) origins without credentials, paths, or query parameters.");

export const applicationSchema = z.object({
  project_uuid: uuid,
  server_uuid: uuid,
  environment_uuid: uuid,
  destination_uuid: uuid.optional(),
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  docker_registry_image_name: z.string().min(1).max(255).regex(/^[a-z0-9][a-z0-9./:_-]*$/),
  docker_registry_image_tag: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/),
  ports_exposes: z.string().default("80").refine((value) => value.split(",").every(
    (port) => /^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535,
  ), "Supply comma-separated container ports between 1 and 65535."),
  domains: z.array(domain).max(10).default([]),
  autogenerate_domain: z.boolean().default(true),
  health_check_enabled: z.boolean().default(false),
  redirect: z.enum(["www", "non-www", "both"]).default("both"),
}).strict();

const commonSchema = applicationSchema.omit({
  docker_registry_image_name: true,
  docker_registry_image_tag: true,
});
const repositoryUrl = z.string().min(1).max(2048).refine((value) => {
  if (/^git@[A-Za-z0-9.-]+:[A-Za-z0-9_./-]+$/.test(value)) return true;
  try {
    const url = new URL(value);
    return ["https:", "http:", "ssh:"].includes(url.protocol) && !url.password &&
      (!url.username || (url.protocol === "ssh:" && url.username === "git")) &&
      !url.search && !url.hash;
  } catch { return false; }
}, "Use an HTTP(S) or SSH Git URL without embedded credentials.");
const repositorySchema = commonSchema.extend({
  git_repository: repositoryUrl,
  git_branch: z.string().min(1).max(255).regex(/^[^\s\x00-\x1f]+$/),
  build_pack: z.enum(["nixpacks", "railpack", "static", "dockerfile", "dockercompose"]),
  base_directory: z.string().max(1024).default("/"),
  publish_directory: z.string().max(1024).optional(),
  install_command: z.string().max(4096).optional(),
  build_command: z.string().max(4096).optional(),
  start_command: z.string().max(4096).optional(),
  dockerfile_location: z.string().max(1024).optional(),
  docker_compose_location: z.string().max(1024).optional(),
  docker_compose_domains: z.array(z.object({
    name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
    domains: z.array(domain).min(1).max(10),
    redirect: z.enum(["www", "non-www", "both"]).default("both"),
  }).strict()).max(30).optional(),
  is_static: z.boolean().optional(),
  is_spa: z.boolean().optional(),
}).strict();

export const applicationTypes = {
  docker_image: { schema: applicationSchema, route: "dockerimage", label: "Docker Image" },
  public_repository: { schema: repositorySchema, route: "public", label: "public Git repository" },
  github_app: {
    schema: repositorySchema.extend({ github_app_uuid: uuid }).strict(),
    route: "private-github-app", label: "private Git repository through a GitHub App",
  },
  deploy_key: {
    schema: repositorySchema.extend({ private_key_uuid: uuid }).strict(),
    route: "private-deploy-key", label: "private Git repository through a deploy key",
  },
  dockerfile: {
    schema: commonSchema.extend({
      dockerfile: z.string().min(1).max(262144).describe("Plain UTF-8 Dockerfile content; the server base64-encodes it for Coolify."),
    }).strict(),
    route: "dockerfile", label: "inline Dockerfile",
  },
};

export const projectSchema = z.object({ project_uuid: uuid }).strict();
export const webhookSchema = z.object({ uuid }).strict();

export class CoolifyClient {
  constructor({ url, token, fetchImpl = fetch }) {
    if (!url || !token || /[\r\n]/.test(token)) {
      throw new Error("Configure COOLIFY_URL and COOLIFY_TOKEN in the MCP process environment.");
    }
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password ||
      parsed.search || parsed.hash || !["/", "/api/v1", "/api/v1/"].includes(parsed.pathname)) {
      throw new Error("COOLIFY_URL must be an instance origin, optionally ending in /api/v1.");
    }
    this.origin = parsed.origin;
    this.api = `${parsed.origin}/api/v1`;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async request(method, path, body) {
    let response;
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
      throw new Error(method === "POST"
        ? "Creation response could not be confirmed. Check existing applications before retrying; the request may have succeeded."
        : "Coolify could not be reached. Check the instance URL and network access.");
    }
    if (!response.ok) {
      const hints = {
        401: "Check token validity and expiration.",
        403: "Creation requires write permission and a team owner/admin; inventory requires read permission. Check API access and IP restrictions.",
        404: "The resource or API route was not found for this team.",
        409: "Resource/domain conflict. Resolve it without overriding existing domains.",
        422: "Coolify rejected the configuration. Check the project, environment, destination, image, ports, and domains.",
        429: "Coolify rate limit reached. Check inventory before retrying creation.",
      };
      throw new Error(`Coolify HTTP ${response.status}. ${hints[response.status] ||
        "Request failed. Check inventory before retrying creation."}`);
    }
    try {
      return await response.json();
    } catch {
      throw new Error(method === "POST"
        ? "Creation may have succeeded, but the response was invalid. Check inventory before retrying."
        : "Coolify returned an invalid JSON response.");
    }
  }

  webhook(applicationUuid) {
    uuid.parse(applicationUuid);
    return {
      url: `${this.api}/deploy?uuid=${encodeURIComponent(applicationUuid)}&force=false`,
      method: "POST",
      authorization: "Authorization: Bearer <deploy-enabled Coolify token>",
    };
  }

  async context(input) {
    const { project_uuid: projectUuid } = projectSchema.parse(input);
    const [project, servers, destinations, applications] = await Promise.all([
      this.request("GET", `/projects/${projectUuid}`),
      this.request("GET", "/servers"),
      this.request("GET", "/destinations"),
      this.request("GET", "/applications"),
    ]);
    return {
      project: {
        uuid: project.uuid,
        name: project.name,
        environments: project.environments?.map((item) => ({ uuid: item.uuid, name: item.name })) || [],
      },
      servers: servers.map((item) => ({ uuid: item.uuid, name: item.name })),
      destinations: destinations.map((item) => ({ uuid: item.uuid, name: item.name,
        server_id: item.server_id, server_uuid: item.server_uuid, network: item.network })),
      applications: applications.filter((item) => project.environments?.some(
        (environment) => (environment.id !== undefined && environment.id === item.environment_id) ||
          environment.uuid === item.environment_uuid,
      ) || item.project_uuid === projectUuid).map((item) => ({
        uuid: item.uuid, name: item.name, build_pack: item.build_pack,
        docker_registry_image_name: item.docker_registry_image_name,
        docker_registry_image_tag: item.docker_registry_image_tag,
        ports_exposes: item.ports_exposes, fqdn: item.fqdn,
      })),
    };
  }

  async plan(input, type = "docker_image") {
    const definition = applicationTypes[type];
    if (!definition) throw new Error("Unsupported application type.");
    const config = definition.schema.parse(input);
    if (config.build_pack === "dockercompose" && config.domains.length > 0) {
      throw new Error("Docker Compose uses docker_compose_domains per service, not application domains.");
    }
    if (config.build_pack !== "dockercompose" && config.docker_compose_domains) {
      throw new Error("docker_compose_domains requires the dockercompose build pack.");
    }
    if (type === "public_repository" && !/^https?:\/\//.test(config.git_repository)) {
      throw new Error("Public repositories require an HTTP(S) URL; use a deploy key for SSH.");
    }
    const [project, server, applications] = await Promise.all([
      this.request("GET", `/projects/${config.project_uuid}`),
      this.request("GET", `/servers/${config.server_uuid}`),
      this.request("GET", "/applications"),
    ]);
    const environment = project.environments?.find((item) => item.uuid === config.environment_uuid);
    if (!environment) throw new Error("Environment does not belong to the selected project.");
    if (server.uuid !== config.server_uuid) throw new Error("Server could not be verified.");
    if (config.destination_uuid) {
      const destination = await this.request("GET", `/destinations/${config.destination_uuid}`);
      if (destination.server_uuid !== server.uuid &&
        !(server.id !== undefined && destination.server_id === server.id)) {
        throw new Error("Destination does not belong to the selected server.");
      }
    }
    const existing = applications.find((item) => item.name === config.name &&
      (item.environment_uuid === environment.uuid ||
        (environment.id !== undefined && item.environment_id === environment.id)));
    if (existing) throw new Error(`An application named ${config.name} already exists in this environment (${uuid.parse(existing.uuid)}). Inspect it before creating another.`);
    return {
      method: "POST",
      endpoint: `${this.api}/applications/${definition.route}`,
      project: { uuid: project.uuid, name: project.name },
      environment: { uuid: environment.uuid, name: environment.name },
      body: {
        ...config,
        ...(type === "dockerfile" ? {
          dockerfile: Buffer.from(config.dockerfile, "utf8").toString("base64"),
        } : {}),
        ...(config.git_repository ? { is_auto_deploy_enabled: false } : {}),
        ...(config.docker_compose_domains ? {
          docker_compose_domains: config.docker_compose_domains.map((service) => ({
            name: service.name, domain: service.domains.join(","), redirect: service.redirect,
          })),
        } : {}),
        domains: config.domains.join(","),
        instant_deploy: false,
        force_domain_override: false,
      },
    };
  }

  async create(input, type = "docker_image") {
    const plan = await this.plan(input, type);
    const result = await this.request("POST", `/applications/${applicationTypes[type].route}`, plan.body);
    const parsedUuid = uuid.safeParse(result?.uuid);
    if (!parsedUuid.success) {
      throw new Error("Creation may have succeeded, but no valid UUID was returned. Check inventory before retrying.");
    }
    return {
      uuid: parsedUuid.data,
      name: plan.body.name,
      project: plan.project,
      environment: plan.environment,
      type,
      ...(type === "docker_image" ? {
        image: `${plan.body.docker_registry_image_name}:${plan.body.docker_registry_image_tag}`,
      } : {}),
      ...(plan.body.git_repository ? {
        git_repository: plan.body.git_repository, build_pack: plan.body.build_pack,
      } : {}),
      ...(type === "dockerfile" ? {
        requested_ports_exposes: plan.body.ports_exposes,
      } : { ports_exposes: plan.body.ports_exposes }),
      deployed: false,
      webhook: this.webhook(parsedUuid.data),
    };
  }

  async getWebhook(input) {
    const { uuid: applicationUuid } = webhookSchema.parse(input);
    const application = await this.request("GET", `/applications/${applicationUuid}`);
    if (application.uuid !== applicationUuid) throw new Error("Application could not be verified.");
    return { uuid: applicationUuid, name: application.name, webhook: this.webhook(applicationUuid) };
  }
}
