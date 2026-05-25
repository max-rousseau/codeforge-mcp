import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type ServerResponse } from "http";
import { registerTools } from "./tools.js";
import { registerSkills } from "./skills.js";
import { config } from "./config.js";
import { log } from "./log.js";
import { INSTRUCTIONS } from "./prompts.js";

const PORT = 8080;
const ALLOWED_METHODS = "POST, GET, DELETE";

const transports: Record<string, StreamableHTTPServerTransport> = {};

/**
 * Build a fresh `McpServer` instance with the server-level INSTRUCTIONS and all
 * tools and skills registered. A new instance is created per session because the
 * SDK forbids reusing a transport across stateful sessions.
 */
function createServer_(): McpServer {
  const server = new McpServer(
    { name: "codeforge", version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server);
  registerSkills(server);
  return server;
}

/** Emit a JSON-RPC error response with the given HTTP status. Used for spec-mandated 4xx replies. */
function sendJsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

const httpServer = createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.url !== "/mcp") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  // /mcp accepts POST (send), GET (open SSE), DELETE (terminate session) only.
  if (req.method !== "POST" && req.method !== "GET" && req.method !== "DELETE") {
    res.writeHead(405, { "Allow": ALLOWED_METHODS });
    res.end();
    return;
  }

  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const reqStart = Date.now();

  // Response-delivery diagnostics. `finish` fires once the last byte is flushed to the OS;
  // `close` without `writableEnded` means the client hung up before we finished writing.
  res.on("finish", () => {
    log.info(`[mcp] ${req.method} sid=${sessionId ?? "-"} status=${res.statusCode} flushed in ${Date.now() - reqStart}ms`);
  });
  res.on("close", () => {
    if (!res.writableEnded) {
      log.error(`[mcp] ${req.method} sid=${sessionId ?? "-"} client disconnected before response flushed after ${Date.now() - reqStart}ms`);
    }
  });

  // Known session: route to its transport.
  if (sessionId && transports[sessionId]) {
    await transports[sessionId].handleRequest(req, res);
    return;
  }

  // Unknown/stale session: spec requires 404 so the client MUST start a new session.
  // Returning anything else (e.g. 400) leaves the client wedged on a dead session ID.
  if (sessionId) {
    log.info(`[mcp] unknown session ${sessionId} on ${req.method}; returning 404`);
    sendJsonRpcError(res, 404, -32001, "Session not found");
    return;
  }

  // No session ID. Per spec, only a POST initialize is valid here;
  // GET / DELETE without an Mcp-Session-Id header is a 400.
  if (req.method !== "POST") {
    sendJsonRpcError(res, 400, -32000, "Bad Request: Mcp-Session-Id header is required");
    return;
  }

  // POST without session — must be an initialize request. The SDK's validateSession() will
  // reject any non-initialize body with 400 before any tool can run, so this is safe.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      transports[id] = transport;
      log.info(`[mcp] session initialized: ${id}`);
    },
  });
  transport.onerror = (err) => log.error(`[mcp] transport error sid=${transport.sessionId ?? "-"}:`, err);
  transport.onclose = () => {
    if (transport.sessionId) {
      delete transports[transport.sessionId];
      log.info(`[mcp] session closed: ${transport.sessionId}`);
    }
  };

  const server = createServer_();
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

httpServer.listen(PORT, () => {
  log.info(`CodeForge MCP server listening on port ${PORT}`);
  if (config.yoloMode) {
    log.info("[codeforge] YOLO_MODE=true — sandbox can reach any internet destination. Credential substitution still applies only to configured APIs.");
  } else {
    log.info("[codeforge] YOLO_MODE=false — sandbox network restricted to configured API domains.");
  }
  if (config.debugMode) {
    log.info("[codeforge] DEBUG_MODE=true — full sandbox I/O and proxy payloads will be logged.");
  }
});
