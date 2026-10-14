import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { pathToFileURL } from "node:url";
import { applicationTypes, projectSchema, webhookSchema, CoolifyClient } from "./coolify.mjs";

export function createServer(client) {
  const server = new McpServer({ name: "coolify-creation-mcp", version: "0.1.0" });
  const register = (name, description, inputSchema, readOnly, handler) => {
    server.registerTool(name, {
      description,
      inputSchema,
      annotations: {
        readOnlyHint: readOnly,
        destructiveHint: false,
        idempotentHint: readOnly,
        openWorldHint: true,
      },
    }, async (input) => {
      try {
        const result = await handler(input);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error) {
        // Unexpected exceptions may contain credentials or upstream response bodies.
        const message = error instanceof Error && !error.message.includes(client.token)
          ? error.message : "Operation failed. Check server configuration.";
        return { isError: true, content: [{ type: "text", text: message }] };
      }
    });
  };
  register("get_creation_context", "Inspect a team-owned project's environments, servers, destinations, and application image settings. Returns selected fields without secrets.", projectSchema, true, (input) => client.context(input));
  for (const [type, definition] of Object.entries(applicationTypes)) {
    register(`plan_${type}_application`,
      `Validate a ${definition.label} application and show its creation request without writing. Checks project/environment, server/destination, and duplicate names. Git sources support Nixpacks, Railpack, static, Dockerfile, and Docker Compose builds.`,
      definition.schema, true, (input) => client.plan(input, type));
    register(`create_${type}_application`,
      `Create one ${definition.label} application using Coolify's API. Requires read and write token permissions. Returns UUID and authenticated deploy webhook. Does not deploy. Git automatic deployment is disabled. On uncertain failure inspect inventory before retrying.`,
      definition.schema, false, (input) => client.create(input, type));
  }
  register("get_deployment_webhook", "Verify a team-owned application and return its deployment URL and required authentication, without triggering deployment or returning a token.", webhookSchema, true, (input) => client.getWebhook(input));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const client = new CoolifyClient({ url: process.env.COOLIFY_URL, token: process.env.COOLIFY_TOKEN });
    await createServer(client).connect(new StdioServerTransport());
  } catch {
    console.error("Could not start coolify-creation-mcp. Check COOLIFY_URL, COOLIFY_TOKEN, and dependencies.");
    process.exitCode = 1;
  }
}
