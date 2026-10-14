import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { CoolifyClient } from "../dist/coolify.js";
import { PublicError, toolErrorMessage } from "../dist/errors.js";

test("unexpected errors suppress credentials, encoded values, and response details", () => {
  const secret = "mock-private-credential";
  for (const error of [
    new Error(secret),
    new Error(Buffer.from(secret).toString("base64")),
    new TypeError("Response body includes a private key"),
    { message: secret },
  ]) {
    assert.equal(
      toolErrorMessage(error),
      "Operation failed. Check server configuration and retry after inspecting resource state.",
    );
  }
});

test("deliberate public guidance remains useful", () => {
  assert.equal(toolErrorMessage(new PublicError("Coolify HTTP 403.")), "Coolify HTTP 403.");
});

test("HTTP redirects never forward the Coolify credential to another endpoint", async () => {
  let redirectedRequests = 0;
  const target = createServer((_request, response) => {
    redirectedRequests += 1;
    response.end("unexpected");
  });
  const origin = createServer((_request, response) => {
    response.writeHead(302, { Location: `http://127.0.0.1:${target.address().port}/capture` });
    response.end();
  });
  await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => origin.listen(0, "127.0.0.1", resolve));
  try {
    const client = new CoolifyClient({
      url: `http://127.0.0.1:${origin.address().port}`,
      token: "mock-token",
    });
    await assert.rejects(client.getWebhook({ uuid: "test-app" }), /could not be reached/);
    assert.equal(redirectedRequests, 0);
  } finally {
    await Promise.all([
      new Promise((resolve) => origin.close(resolve)),
      new Promise((resolve) => target.close(resolve)),
    ]);
  }
});
