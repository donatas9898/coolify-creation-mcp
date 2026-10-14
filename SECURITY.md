# Security

Security fixes target the current `main` branch. This project is an early release;
upgrade to the latest tested commit when a security fix is announced.

## Report a vulnerability

Use this repository's **Security → Report a vulnerability** option when available.
If private reporting is unavailable, ask the maintainer to enable it in an issue
that contains no vulnerability details. Do not include tokens, passwords, private
keys, real configuration files, or exploit details in public issues.

## Deployment boundaries

- Use a team-scoped Coolify token with `read` and `write` permissions.
- Use HTTPS for remote instances. Plain HTTP requires explicit opt-in except on
  loopback hosts; it exposes the token and request contents on the network.
- Keep credentials in your MCP host's private environment configuration.
- Treat tool inputs and output as data visible to the host and its conversation.
  Creation previews include commands and Dockerfile content. Use Coolify's secret
  facilities instead of embedding credentials in those inputs.
- Inventory includes available team servers/destinations and selected project
  applications. Use a separate token/team when stronger isolation is needed.
- The MCP is a local stdio process. It exposes no public HTTP listener.

The server blocks redirects and returns selected response fields and safe error
guidance. These controls do not replace Coolify's authorization, your MCP host's
data policies, or control of your local machine and configured API endpoint.
