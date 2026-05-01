import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "http";
import { registerTools } from "./tools.js";
import { registerSkills } from "./skills.js";
import { config } from "./config.js";
import { log } from "./log.js";
import { INSTRUCTIONS } from "./prompts.js";

const PORT = 8080;

const transports: Record<string, StreamableHTTPServerTransport> = {};

function createServer_(): McpServer {
  const server = new McpServer(
    { name: "codeforge", version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server);
  registerSkills(server);
  return server;
}

const httpServer = createServer(async (req, res) => {
  if (req.url === "/mcp" && (req.method === "POST" || req.method === "GET" || req.method === "DELETE")) {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && transports[sessionId]) {
      await transports[sessionId].handleRequest(req, res);
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => { transports[id] = transport; },
    });
    transport.onclose = () => {
      if (transport.sessionId) delete transports[transport.sessionId];
    };

    const server = createServer_();
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } else if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
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
