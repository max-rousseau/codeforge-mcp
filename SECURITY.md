# Security Policy

## Threat Model

CodeForge protects a narrow, explicit perimeter. Reading this section is the cheapest way to understand what the system is and isn't built for.

### Trusted (in scope of "no compromise")

- The host operator and the host machine itself.
- The Docker daemon and base images.
- The MCP client process (e.g. Claude Desktop) connecting to `localhost:8080`.
- The MCP server's own runtime configuration (`.env`, `apis/*/config.json`).

### Untrusted (the actual adversary)

- The TypeScript code submitted to `execute_code`. Treat it as written by a capable adversary — even when the LLM is friendly, prompt injection or compromised tool-input can turn any call into a hostile payload.

### Defenses against that adversary

- Sandbox code never sees real credentials. Token names are substituted on the wire by the proxy and reverse-substituted out of responses, so the sandbox can only refer to credentials by name.
- Sandbox code can only reach hosts listed in `apis/*/config.json` (Deno `--allow-net` allowlist). YOLO mode disables this and is opt-in.
- Sandbox has a read-only root filesystem; only `/tmp` (tmpfs) and `/skills` (Docker volume) are writable.
- Sandbox container runs as the unprivileged `deno` user with `no-new-privileges` and a 512 MB memory cap.
- The MCP server's Docker socket access is filtered down to three exec-related endpoints scoped to the sandbox container — it cannot create, modify, list, or inspect any other container.
- The proxy itself runs as the unprivileged `mitmproxy` user after a brief root init.

### Out of scope (do not file as bugs)

- Any attack from a network adversary against `:8080` — the server is localhost-only, no TLS, no auth, by design.
- Any attack from the host operator. If they want to read `apis/*/config.json` directly, they own the box.
- Supply-chain compromise of base images, npm packages, or pip packages — pinning helps but is not a security claim.
- Side-channel inference of credentials by sandbox code (timing, error messages from upstream). The substitution model assumes the adversary cannot control the API's response content.
- DoS of the sandbox via runaway code. Memory limit + manual `docker compose restart sandbox` is the answer; there is no automatic mitigation.

## Reporting a vulnerability

If you believe you have found a security issue that falls within the in-scope perimeter above, open a GitHub issue describing what you found. A minimal reproducible example speeds up triage considerably.

Reports for issues listed under "Out of scope" above will be closed without further action — that is not dismissive, it is the system working as designed.

## Scope of supported versions

Nothing is officially supported. No LTS, no patch backports, no SLA. Run `main`, accept the risk. Godspeed.
