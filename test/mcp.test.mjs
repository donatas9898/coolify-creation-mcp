import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

test("stdio MCP handshake, discovery, webhook call, and input validation", async () => {
  const requests = [];
  const api = createServer((request, response) => {
    requests.push(request.url);
    assert.equal(request.headers.authorization, "Bearer mock-token");
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ uuid: "test-app", name: "Test" }));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../src/index.mjs", import.meta.url))],
    env: {
      ...process.env,
      COOLIFY_URL: `http://127.0.0.1:${api.address().port}`,
      COOLIFY_TOKEN: "mock-token",
    },
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      "create_deploy_key_application", "create_docker_image_application",
      "create_dockerfile_application", "create_github_app_application",
      "create_public_repository_application", "get_creation_context",
      "get_deployment_webhook", "plan_deploy_key_application",
      "plan_docker_image_application", "plan_dockerfile_application",
      "plan_github_app_application", "plan_public_repository_application",
    ].sort());
    const creation = tools.find((tool) => tool.name === "create_docker_image_application");
    assert.equal(creation.annotations.readOnlyHint, false);
    const result = await client.callTool({ name: "get_deployment_webhook", arguments: { uuid: "test-app" } });
    assert.equal(result.isError, undefined);
    assert.equal(JSON.parse(result.content[0].text).name, "Test");
    const invalid = await client.callTool({ name: "get_deployment_webhook", arguments: { uuid: "../secrets" } });
    assert.equal(invalid.isError, true);
    assert.deepEqual(requests, ["/api/v1/applications/test-app"]);
  } finally {
    await client.close();
    await new Promise((resolve) => api.close(resolve));
  }
});
