import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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

test("remote HTTP is rejected unless deliberately enabled", () => {
  assert.throws(
    () => new CoolifyClient({ url: "http://coolify.example.com", token: "mock-token" }),
    /require HTTPS/,
  );
  assert.doesNotThrow(
    () =>
      new CoolifyClient({
        url: "http://coolify.example.com",
        token: "mock-token",
        allowInsecureHttp: true,
      }),
  );
  for (const url of ["http://localhost:8000", "http://127.0.0.1:8000", "http://[::1]:8000"]) {
    assert.doesNotThrow(() => new CoolifyClient({ url, token: "mock-token" }));
  }
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

test("startup explains insecure transport rejection without printing credentials", () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    {
      env: {
        ...process.env,
        COOLIFY_URL: "http://coolify.example.com",
        COOLIFY_TOKEN: "mock-private-credential",
        COOLIFY_ALLOW_INSECURE_HTTP: "false",
      },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /require HTTPS/);
  assert.equal(result.stderr.includes("mock-private-credential"), false);
  assert.equal(result.stdout, "");
});
