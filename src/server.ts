import { McpServer } from "@modelcontextprotocol/server";
import { applicationTypes, projectSchema, webhookSchema } from "./schemas.js";
import type { CoolifyClient } from "./coolify.js";
import type { ApplicationType } from "./schemas.js";
import type { z } from "zod";
import { toolErrorMessage } from "./errors.js";

export function createServer(client: CoolifyClient) {
  const server = new McpServer({ name: "coolify-creation-mcp", version: "0.1.0" });
  const register = <Schema extends z.ZodObject>(
    name: string,
    description: string,
    inputSchema: Schema,
    readOnly: boolean,
    handler: (input: z.output<Schema>) => Promise<unknown>,
  ) => {
    const schema: z.ZodObject = inputSchema;
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema,
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: false,
          idempotentHint: readOnly,
          openWorldHint: true,
        },
      },
      async (input) => {
        try {
          const result = await handler(inputSchema.parse(input));
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } catch (error) {
          return { isError: true, content: [{ type: "text", text: toolErrorMessage(error) }] };
        }
      },
    );
  };
  register(
    "get_creation_context",
    "Inspect a project's environments and applications, plus available servers and destinations across the authenticated team. inventory_scope labels those boundaries. Returns selected fields without credentials.",
    projectSchema,
    true,
    (input) => client.context(input),
  );
  for (const type of Object.keys(applicationTypes) as ApplicationType[]) {
    const definition = applicationTypes[type];
    register(
      `plan_${type}_application`,
      `Validate a ${definition.label} application and show its creation request without writing. Checks project/environment, server/destination, and duplicate names. Git sources support Nixpacks, Railpack, static, Dockerfile, and Docker Compose builds.`,
      definition.schema,
      true,
      (input) => client.plan(input, type),
    );
    register(
      `create_${type}_application`,
      `Create one ${definition.label} application using Coolify's API. Requires read and write token permissions. Returns UUID and authenticated deploy webhook. Does not deploy. Git automatic deployment is disabled. On uncertain failure inspect inventory before retrying.`,
      definition.schema,
      false,
      (input) => client.create(input, type),
    );
  }
  register(
    "get_deployment_webhook",
    "Verify a team-owned application and return its deployment URL and required authentication, without triggering deployment or returning a token.",
    webhookSchema,
    true,
    (input) => client.getWebhook(input),
  );
  return server;
}
