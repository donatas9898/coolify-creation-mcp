import { z } from "zod";

export const uuid = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const domain = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
    );
  }, "Domains must be HTTP(S) origins without credentials, paths, or query parameters.");

export const applicationSchema = z
  .object({
    project_uuid: uuid,
    server_uuid: uuid,
    environment_uuid: uuid,
    destination_uuid: uuid.optional(),
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    docker_registry_image_name: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-z0-9][a-z0-9./:_-]*$/),
    docker_registry_image_tag: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/),
    ports_exposes: z
      .string()
      .default("80")
      .refine(
        (value) =>
          value
            .split(",")
            .every((port) => /^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535),
        "Supply comma-separated container ports between 1 and 65535.",
      ),
    domains: z.array(domain).max(10).default([]),
    autogenerate_domain: z.boolean().default(true),
    health_check_enabled: z.boolean().default(false),
    redirect: z.enum(["www", "non-www", "both"]).default("both"),
  })
  .strict();

const commonSchema = applicationSchema.omit({
  docker_registry_image_name: true,
  docker_registry_image_tag: true,
});
const repositoryUrl = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    if (/^git@[A-Za-z0-9.-]+:[A-Za-z0-9_./-]+$/.test(value)) return true;
    try {
      const url = new URL(value);
      return (
        ["https:", "http:", "ssh:"].includes(url.protocol) &&
        !url.password &&
        (!url.username || (url.protocol === "ssh:" && url.username === "git")) &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, "Use an HTTP(S) or SSH Git URL without embedded credentials.");
const repositorySchema = commonSchema
  .extend({
    git_repository: repositoryUrl,
    git_branch: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[^\s\x00-\x1f]+$/),
    build_pack: z.enum(["nixpacks", "railpack", "static", "dockerfile", "dockercompose"]),
    base_directory: z.string().max(1024).default("/"),
    publish_directory: z.string().max(1024).optional(),
    install_command: z.string().max(4096).optional(),
    build_command: z.string().max(4096).optional(),
    start_command: z.string().max(4096).optional(),
    dockerfile_location: z.string().max(1024).optional(),
    docker_compose_location: z.string().max(1024).optional(),
    docker_compose_domains: z
      .array(
        z
          .object({
            name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
            domains: z.array(domain).min(1).max(10),
            redirect: z.enum(["www", "non-www", "both"]).default("both"),
          })
          .strict(),
      )
      .max(30)
      .optional(),
    is_static: z.boolean().optional(),
    is_spa: z.boolean().optional(),
  })
  .strict();

export const applicationTypes = {
  docker_image: { schema: applicationSchema, route: "dockerimage", label: "Docker Image" },
  public_repository: { schema: repositorySchema, route: "public", label: "public Git repository" },
  github_app: {
    schema: repositorySchema.extend({ github_app_uuid: uuid }).strict(),
    route: "private-github-app",
    label: "private Git repository through a GitHub App",
  },
  deploy_key: {
    schema: repositorySchema.extend({ private_key_uuid: uuid }).strict(),
    route: "private-deploy-key",
    label: "private Git repository through a deploy key",
  },
  dockerfile: {
    schema: commonSchema
      .extend({
        dockerfile: z
          .string()
          .min(1)
          .max(262144)
          .describe("Plain UTF-8 Dockerfile content; the server base64-encodes it for Coolify."),
      })
      .strict(),
    route: "dockerfile",
    label: "inline Dockerfile",
  },
};

export const projectSchema = z.object({ project_uuid: uuid }).strict();
export const webhookSchema = z.object({ uuid }).strict();

export type ApplicationType = keyof typeof applicationTypes;
export type ApplicationConfig = z.output<(typeof applicationTypes)[ApplicationType]["schema"]>;
export type ParsedApplicationConfig = z.output<typeof commonSchema> &
  Partial<
    z.output<typeof applicationSchema> &
      z.output<typeof repositorySchema> & {
        dockerfile: string;
        github_app_uuid: string;
        private_key_uuid: string;
      }
  >;
export type ProjectInput = z.input<typeof projectSchema>;
export type WebhookInput = z.input<typeof webhookSchema>;
