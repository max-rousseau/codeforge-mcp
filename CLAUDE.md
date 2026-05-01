# CodeForge MCP — Agent Notes

## Container Names

All three services use explicit `container_name` entries in `docker-compose.yaml`: `codeforge-mcp-server`, `codeforge-proxy`, `codeforge-sandbox`. The sandbox name is hardcoded in `mcp-server/src/sandbox.ts` and in the Docker socket proxy whitelist (`mcp-server/docker-proxy.cjs`) — both constants and the compose entry must stay in sync.

## APIs Are Image-Baked

`apis/` is COPYed into both the `mcp-server` and `proxy` images at build time — there is no runtime bind mount. Changes to `apis/` on the host require `docker compose up -d --build mcp-server proxy` to take effect.

## MCP Transport

The server uses Streamable HTTP with stateful sessions (not SSE, not stdio). Each client connection gets a fresh `McpServer` + `StreamableHTTPServerTransport` pair, tracked by session ID. The SDK (v1.29+) forbids reusing a stateless transport across requests — do not revert to a single shared transport. Claude Desktop connects via `npx mcp-remote http://localhost:8080/mcp`.

## Proxy Host Resolution

In transparent mode, mitmproxy's `flow.request.host` returns the destination IP, not the hostname — so the substitution addon must use `flow.request.pretty_host` (which prefers SNI / Host header) to look up per-host credential maps. Reverting to `flow.request.host` silently breaks all credential substitution because the configured host strings (e.g. `api.tavily.com`) never match the IP keys.

## Proxy Privilege Drop

The proxy entrypoint runs as root only long enough to: generate the mitmproxy CA cert, configure iptables NAT rules, and `chown -R mitmproxy:mitmproxy /certs`. Then it `exec su -s /bin/bash mitmproxy -c "mitmdump ..."` to run mitmproxy as the unprivileged `mitmproxy` user (created in `proxy/Dockerfile`). The `chown` is required because mitmproxy creates `mitmproxy-ca.pem` (CA private key) at `0600` via its `umask_secret()` context — the running mitmproxy needs read access to the key for on-the-fly leaf cert generation.

## API Config Files

`apis/*/config.json` files contain real secrets and are gitignored. Only the `apis/example/` directory is committed. Never read or log config files outside of the proxy addon and the MCP server's apis module.

## YOLO_MODE

The server-level `instructions` block is composed at startup from `llm-instructions.yaml` to reflect the active network mode (`YOLO_MODE` env). Do not layer "if YOLO is enabled" text into per-tool descriptions — mode-conditional copy belongs in the top-level instructions only.

## LLM-facing copy

All LLM-facing strings (server `instructions`, tool descriptions, parameter descriptions, prompt descriptions) live in `llm-instructions.yaml` at the repo root, validated against the Zod `PromptsSchema` in `mcp-server/src/prompts.ts` at startup. When adding a new tool/param, both files must be updated together — a missing key is a fatal startup error. The YAML is image-baked, so edits require `./rebuild.sh`.
