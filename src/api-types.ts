import { z } from "zod";
import { uuid } from "./schemas.js";

export const environmentResponseSchema = z.object({
  id: z.number().optional(),
  uuid,
  name: z.string(),
});

export const projectResponseSchema = z.object({
  uuid,
  name: z.string(),
  environments: z.array(environmentResponseSchema).default([]),
});

export const serverResponseSchema = z.object({
  id: z.number().optional(),
  uuid,
  name: z.string(),
});

export const destinationResponseSchema = z.object({
  uuid: uuid.optional(),
  name: z.string().optional(),
  server_id: z.number().optional(),
  server_uuid: uuid.optional(),
  network: z.string().optional(),
});

export const applicationResponseSchema = z.object({
  uuid,
  name: z.string(),
  project_uuid: uuid.optional(),
  environment_id: z.number().optional(),
  environment_uuid: uuid.optional(),
  build_pack: z.string().nullish(),
  docker_registry_image_name: z.string().nullish(),
  docker_registry_image_tag: z.string().nullish(),
  ports_exposes: z.string().nullish(),
  fqdn: z.string().nullish(),
});

export const creationResponseSchema = z.object({ uuid });

export function parseResponse<Schema extends z.ZodType>(
  schema: Schema,
  data: unknown,
  label: string,
): z.output<Schema> {
  const result = schema.safeParse(data);
  if (!result.success) throw new Error(`Coolify returned invalid ${label} metadata.`);
  return result.data;
}
