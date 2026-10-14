# Coolify Creation MCP

An MCP server for **creating Coolify applications** from container images,
Git repositories, inline Dockerfiles, and repository-based Docker Compose.
Use it with any Coolify instance and team-owned project.

## Tools

| Tool | Behavior |
| --- | --- |
| `get_creation_context` | Lists project environments, servers, destinations, and selected application settings. |
| `plan_docker_image_application` / `create_docker_image_application` | Prebuilt container image. |
| `plan_public_repository_application` / `create_public_repository_application` | Public Git repository. |
| `plan_github_app_application` / `create_github_app_application` | Private Git repository using an existing GitHub App. |
| `plan_deploy_key_application` / `create_deploy_key_application` | Private Git repository using an existing deploy key. |
| `plan_dockerfile_application` / `create_dockerfile_application` | Inline Dockerfile without a repository. |
| `get_deployment_webhook` | Verifies application access and returns its authenticated deploy URL. |

Each `plan_*` tool validates ownership relationships and duplicate names and returns
the exact request without writing. Each `create_*` tool returns the new UUID and
deployment webhook. Git sources support `nixpacks`, `railpack`, `static`, `dockerfile`,
and `dockercompose` build packs, subject to your installed Coolify version.

Creation never starts a deployment or overrides existing domains. Git automatic
deployment is disabled on creation. Services, databases, edits, and deletion are
outside this release.

## Install and connect

Requires Node.js 22 or newer.

```sh
git clone https://github.com/donatas9898/coolify-creation-mcp.git
cd coolify-creation-mcp
npm ci
npm run build
```

Set `COOLIFY_URL` to your instance origin, for example `https://coolify.example.com`.
`/api/v1` is also accepted. Supply `COOLIFY_TOKEN` through your MCP host's secret
configuration or inherited environment. It is never a tool argument or returned
in tool output. The server does not automatically load `.env` files.

Configure your MCP host to run `node /absolute/path/to/coolify-creation-mcp/dist/index.js`
over stdio. A typical host configuration is:

```json
{
  "mcpServers": {
    "coolify-creation": {
      "command": "node",
      "args": ["/absolute/path/to/coolify-creation-mcp/dist/index.js"],
      "env": {
        "COOLIFY_URL": "https://coolify.example.com",
        "COOLIFY_TOKEN": "<configure privately in your MCP host>"
      }
    }
  }
}
```

On Windows use `C:/path/to/coolify-creation-mcp/dist/index.js`. This is a local
stdio server; there is no public HTTP endpoint, Docker service, or hosted connector.

## Token permissions

Use a token for the team that owns the project, with **read + write** permissions.
The token owner must be a team administrator or owner to create applications.
Root is unnecessary. Deploy webhooks require a token with **deploy** permission.
API access and IP restrictions still apply. The server never requests sensitive
environment values.

See [Coolify token permissions](https://coolify.io/docs/core/security/credentials/api-tokens).

## Create an application

1. Call `get_creation_context` with your project's UUID.
2. Copy `examples/docker-image-application.json` and replace the placeholder
   project, environment, server, and destination UUIDs with your own identifiers.
3. Choose your image repository, image tag, container ports, and optional domains.
4. Call `plan_docker_image_application` to inspect the request.
5. Call `create_docker_image_application` to create the application.

The example uses the public `nginx:alpine` image and container port `80`.
It requests a generated preview domain. Supply your own HTTP(S) origins in
`domains` when available. Creating an application does not configure DNS,
publish a container image, or start a deployment.

The creation result includes:

```json
{
  "uuid": "created-application-uuid",
  "deployed": false,
  "webhook": {
    "url": "https://coolify.example.com/api/v1/deploy?uuid=created-application-uuid&force=false",
    "method": "POST",
    "authorization": "Authorization: Bearer <deploy-enabled Coolify token>"
  }
}
```

Use that URL in your deployment automation with a deploy-enabled Bearer token.
This MCP returns the webhook without triggering it or configuring external secrets.

## Other application sources

The `examples/` directory includes one configuration for each source and a
Docker Compose configuration. Replace placeholder identifiers and repository URLs
before calling the corresponding plan or creation tool.

For Git applications, provide `git_repository`, `git_branch`, and `build_pack`.
Optional fields include `base_directory`, `publish_directory`, `install_command`,
`build_command`, `start_command`, `is_static`, and `is_spa`. Use
`dockerfile_location` for a repository Dockerfile. GitHub App applications require
`github_app_uuid`; deploy-key applications require `private_key_uuid`. These refer
to credentials already configured in Coolify: do not pass key contents or embed
tokens/passwords in repository URLs.

For Docker Compose, use any Git source tool with `build_pack: "dockercompose"`.
Set `docker_compose_location` and optional `docker_compose_domains`, using the
service names from your Compose file:

```json
{
  "docker_compose_domains": [
    { "name": "web", "domains": ["https://app.example.com"], "redirect": "both" }
  ]
}
```

Leave application-level `domains` empty for Compose. Coolify uses per-service
domains rather than automatic application domains. This server uses the supported
Git application endpoints, not the removed standalone `/applications/dockercompose`
endpoint. Inline Compose services without Git are outside this release.

For inline Dockerfiles, pass plain UTF-8 text in `dockerfile`. The MCP base64-encodes
it as required by Coolify's API. Include the correct `EXPOSE` instruction because
Coolify derives inline Dockerfile ports from that content. The preview contains
the encoded Dockerfile; base64 is not encryption. Keep secrets out of Dockerfiles
and build/start commands.

## Failure handling

The tool rejects duplicate names in the selected environment. It does not retry
creation requests: a timeout or invalid response may mean the application was
created. Check inventory before another attempt. Duplicate checks reduce accidental
repeats but are not a transactional idempotency guarantee; avoid concurrent creates
for the same name. API errors return status and guidance, not raw upstream bodies.

The API enforces team access. The MCP also checks the selected environment belongs
to the project and the destination belongs to the server. Tool outputs use selected
fields; full environment values, tokens, and configuration snapshots are not returned.

## Data handling

API requests go only to the configured `COOLIFY_URL`. The server has no telemetry,
analytics endpoint, or application log file. Redirects are rejected, and credentials
are supplied through the process environment rather than tool arguments.

Use HTTPS for remote Coolify instances: HTTP sends the Bearer token and request
body without transport encryption. HTTP remains supported for local development
and explicitly configured private-network deployments.

Tool inputs and results are visible to your MCP host and may enter its conversation
or logs according to that host's settings. Preview tools return the creation body,
including commands and base64-encoded Dockerfiles. Do not embed secrets in those
fields; use Coolify's environment/secret facilities. Inventory tools intentionally
return names, identifiers, image names, and domains. Unexpected exceptions return
a generic message; only deliberate non-sensitive guidance is exposed.

## Development

Source code uses strict TypeScript and compiles to Node.js ES modules in `dist/`.

| Module | Purpose |
| --- | --- |
| `src/schemas.ts` | Tool input schemas and inferred configuration types. |
| `src/api-types.ts` | Runtime validation and types for Coolify API responses. |
| `src/errors.ts` | Public guidance and suppression of unexpected exception details. |
| `src/coolify.ts` | API client, creation validation, and webhook generation. |
| `src/server.ts` | MCP tool registration. |
| `src/index.ts` | Stdio entry point. |

```sh
npm run check
npm run build
npm test
```

`npm run check` runs TypeScript type checking and Biome formatting checks.
Use `npm run format` to apply formatting. `npm test` builds the server first,
then runs the existing Node.js tests against the compiled JavaScript.
Tests use mocked Coolify responses and a real stdio MCP client/server handshake.
They never create production resources. CI runs them on Linux and Windows.

Built with the official [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk).
Creation uses the documented [Coolify application endpoints](https://raw.githubusercontent.com/coollabsio/coolify/main/openapi.yaml):
`/applications/dockerimage`, `/applications/public`, `/applications/private-github-app`,
`/applications/private-deploy-key`, and `/applications/dockerfile`.
Webhooks use [`POST /deploy`](https://coolify.io/docs/api/endpoints/deployments/deploy-by-tag-or-uuid).
