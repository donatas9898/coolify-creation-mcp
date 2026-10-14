#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { CoolifyClient } from "./coolify.js";
import { createServer } from "./server.js";

try {
  const client = new CoolifyClient({
    url: process.env.COOLIFY_URL,
    token: process.env.COOLIFY_TOKEN,
  });
  await createServer(client).connect(new StdioServerTransport());
} catch {
  console.error(
    "Could not start coolify-creation-mcp. Check COOLIFY_URL, COOLIFY_TOKEN, and dependencies.",
  );
  process.exitCode = 1;
}
