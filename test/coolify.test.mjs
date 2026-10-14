import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { CoolifyClient, applicationSchema } from "../src/coolify.mjs";

const input = JSON.parse(await readFile(new URL("../examples/docker-image-application.json", import.meta.url)));
const token = "test-token-never-printed";
const project = {
  uuid: input.project_uuid, name: "Example Project",
  environments: [{ id: 7, uuid: input.environment_uuid, name: "production" }],
};
const server = { id: 9, uuid: input.server_uuid, name: "localhost" };

function setup(overrides = {}) {
  const calls = [];
  const data = {
    [`/projects/${input.project_uuid}`]: project,
    [`/servers/${input.server_uuid}`]: server,
    [`/destinations/${input.destination_uuid}`]: { server_id: 9 },
    "/applications": [],
    "/applications/dockerimage": { uuid: "created-app" },
    "/applications/public": { uuid: "created-app" },
    "/applications/private-github-app": { uuid: "created-app" },
    "/applications/private-deploy-key": { uuid: "created-app" },
    "/applications/dockerfile": { uuid: "created-app" },
    ...overrides,
  };
  const client = new CoolifyClient({
    url: "https://coolify.example.com/api/v1/", token,
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      assert.equal(options.redirect, "error");
      const result = data[new URL(url).pathname.replace("/api/v1", "")];
      if (result instanceof Error) throw result;
      if (result instanceof Response) return result;
      return Response.json(result);
    },
  });
  return { client, calls };
}

test("creates an image application and returns a token-free webhook", async () => {
  const { client, calls } = setup();
  const result = await client.create(input);
  const writes = calls.filter((call) => call.method === "POST");
  assert.equal(writes.length, 1);
  const body = JSON.parse(writes[0].body);
  assert.equal(body.instant_deploy, false);
  assert.equal(body.force_domain_override, false);
  assert.equal(body.domains, "");
  assert.equal(body.docker_registry_image_tag, "alpine");
  assert.equal(result.deployed, false);
  assert.equal(result.webhook.url, "https://coolify.example.com/api/v1/deploy?uuid=created-app&force=false");
  assert.equal(JSON.stringify(result).includes(token), false);
});

test("planning never writes and converts approved domains", async () => {
  const { client, calls } = setup();
  const plan = await client.plan({ ...input, domains: ["https://site.example.com"] });
  assert.equal(plan.body.domains, "https://site.example.com");
  assert.ok(calls.every((call) => call.method === "GET"));
});

test("rejects a duplicate application within the selected environment", async () => {
  const { client, calls } = setup({
    "/applications": [{ name: "example-app", uuid: "existing", environment_id: 7 }],
  });
  await assert.rejects(client.create(input), /already exists/);
  assert.ok(calls.every((call) => call.method === "GET"));
});

test("rejects an environment outside the project and destination outside the server", async () => {
  const first = setup({ [`/projects/${input.project_uuid}`]: { ...project, environments: [] } });
  await assert.rejects(first.client.create(input), /Environment does not belong/);
  const second = setup({ [`/destinations/${input.destination_uuid}`]: { server_id: 100 } });
  await assert.rejects(second.client.create(input), /Destination does not belong/);
});

test("does not retry ambiguous creation failure or expose upstream errors", async () => {
  const { client, calls } = setup({ "/applications/dockerimage": new Error(token) });
  await assert.rejects(client.create(input), (error) => {
    assert.match(error.message, /may have succeeded/);
    assert.equal(error.message.includes(token), false);
    return true;
  });
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});

test("write denial reports permission requirements without returning upstream body", async () => {
  const { client } = setup({
    "/applications/dockerimage": Response.json({ message: token }, { status: 403 }),
  });
  await assert.rejects(client.create(input), (error) => {
    assert.match(error.message, /write permission/);
    assert.equal(error.message.includes(token), false);
    return true;
  });
});

test("unconfirmed creation response requires inventory inspection", async () => {
  const { client } = setup({ "/applications/dockerimage": { message: "ok" } });
  await assert.rejects(client.create(input), /no valid UUID/);
});

test("context returns only this project's application summaries", async () => {
  const { client } = setup({
    "/servers": [{ ...server, private_key: token }],
    "/destinations": [{ uuid: "destination", network: "coolify", secret: token }],
    "/applications": [
      { uuid: "ours", name: "ours", environment_id: 7, password: token },
      { uuid: "other", name: "other", environment_id: 8 },
      { uuid: "unrelated", name: "unrelated" },
    ],
  });
  const context = await client.context({ project_uuid: input.project_uuid });
  assert.deepEqual(context.applications.map((item) => item.uuid), ["ours"]);
  assert.equal(JSON.stringify(context).includes(token), false);
});

test("webhook tool verifies application access without deploying", async () => {
  const { client, calls } = setup({ "/applications/existing": { uuid: "existing", name: "site" } });
  const result = await client.getWebhook({ uuid: "existing" });
  assert.equal(result.name, "site");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
});

test("rejects unexpected settings, invalid ports, and credential-bearing URLs", () => {
  assert.throws(() => applicationSchema.parse({ ...input, instant_deploy: true }));
  assert.throws(() => applicationSchema.parse({ ...input, ports_exposes: "0,70000" }));
  assert.throws(() => applicationSchema.parse({ ...input, domains: ["https://user:secret@example.com"] }));
  assert.throws(() => new CoolifyClient({ url: "https://user:secret@example.com", token }));
});

const { docker_registry_image_name, docker_registry_image_tag, ...commonInput } = input;
const gitInput = {
  ...commonInput,
  git_repository: "https://github.com/example/application.git",
  git_branch: "main",
  build_pack: "nixpacks",
};

for (const [type, config, route] of [
  ["public_repository", gitInput, "public"],
  ["github_app", { ...gitInput, github_app_uuid: "github-source" }, "private-github-app"],
  ["deploy_key", { ...gitInput, git_repository: "git@example.com:org/application.git", private_key_uuid: "key-id" }, "private-deploy-key"],
  ["dockerfile", { ...commonInput, dockerfile: "FROM nginx:alpine\nEXPOSE 80\n" }, "dockerfile"],
]) {
  test(`creates ${type} through the documented endpoint without deployment`, async () => {
    const { client, calls } = setup();
    const result = await client.create(config, type);
    const writes = calls.filter((call) => call.method === "POST");
    assert.equal(writes.length, 1);
    assert.equal(new URL(writes[0].url).pathname, `/api/v1/applications/${route}`);
    const body = JSON.parse(writes[0].body);
    assert.equal(body.instant_deploy, false);
    assert.equal(result.type, type);
    assert.equal(result.deployed, false);
    if (type === "dockerfile") {
      assert.equal(Buffer.from(body.dockerfile, "base64").toString("utf8"), config.dockerfile);
      assert.equal(JSON.stringify(result).includes("FROM nginx"), false);
    } else {
      assert.equal(body.is_auto_deploy_enabled, false);
    }
  });
}

for (const buildPack of ["nixpacks", "railpack", "static", "dockerfile", "dockercompose"]) {
  test(`accepts ${buildPack} for Git repository applications`, async () => {
    const { client } = setup();
    const result = await client.plan({ ...gitInput, build_pack: buildPack }, "public_repository");
    assert.equal(result.body.build_pack, buildPack);
  });
}

test("Compose service domains are serialized using Coolify's field names", async () => {
  const { client } = setup();
  const plan = await client.plan({
    ...gitInput, build_pack: "dockercompose", docker_compose_location: "/compose.yaml",
    docker_compose_domains: [{ name: "web", domains: ["https://app.example.com", "https://www.app.example.com"] }],
  }, "public_repository");
  assert.deepEqual(plan.body.docker_compose_domains, [{
    name: "web", domain: "https://app.example.com,https://www.app.example.com", redirect: "both",
  }]);
  await assert.rejects(client.plan({
    ...gitInput, build_pack: "dockercompose", domains: ["https://app.example.com"],
  }, "public_repository"), /per service/);
  await assert.rejects(client.plan({
    ...gitInput, docker_compose_domains: [],
  }, "public_repository"), /requires the dockercompose/);
});

test("private repository modes require credential identifiers, not credential contents", async () => {
  const { client, calls } = setup();
  await assert.rejects(client.create(gitInput, "github_app"));
  await assert.rejects(client.create(gitInput, "deploy_key"));
  await assert.rejects(client.create({
    ...gitInput, git_repository: "https://user:secret@example.com/repo.git",
  }, "public_repository"));
  await assert.rejects(client.create({
    ...gitInput, git_repository: "git@example.com:org/application.git",
  }, "public_repository"), /require an HTTP/);
  assert.equal(calls.length, 0);
});
