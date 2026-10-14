#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { CoolifyClient } from "./coolify.js";
import { createServer } from "./server.js";
import { toolErrorMessage } from "./errors.js";

try {
  const client = new CoolifyClient({
    url: process.env.COOLIFY_URL,
    token: process.env.COOLIFY_TOKEN,
    allowInsecureHttp: process.env.COOLIFY_ALLOW_INSECURE_HTTP === "true",
  });
  await createServer(client).connect(new StdioServerTransport());
} catch (error) {
  console.error(toolErrorMessage(error));
  process.exitCode = 1;
}
