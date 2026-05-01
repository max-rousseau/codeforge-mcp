const http = require("http");
const net = require("net");
const fs = require("fs");

const DOCKER_SOCK = process.env.DOCKER_PROXY_UPSTREAM || "/var/run/docker.sock";
const PROXY_SOCK = process.env.DOCKER_PROXY_LISTEN || "/var/run/codeforge.sock";
const CONTAINER = "codeforge-sandbox";

const ALLOWED = [
  { method: "POST", pattern: new RegExp(`^(/v[\\d.]+)?/containers/${CONTAINER}/exec$`) },
  { method: "POST", pattern: /^(\/v[\d.]+)?\/exec\/[a-f0-9]+\/start$/ },
  { method: "GET",  pattern: /^(\/v[\d.]+)?\/exec\/[a-f0-9]+\/json$/ },
];

function isAllowed(method, path) {
  return ALLOWED.some((r) => r.method === method && r.pattern.test(path));
}

const server = http.createServer((req, res) => {
  if (!isAllowed(req.method, req.url)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden\n");
    req.resume();
    return;
  }

  const upstreamReq = http.request(
    {
      socketPath: DOCKER_SOCK,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstreamReq.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Bad Gateway\n");
    } else {
      res.destroy();
    }
  });

  req.on("error", () => upstreamReq.destroy());
  req.pipe(upstreamReq);
});

server.on("upgrade", (req, clientSocket, head) => {
  if (!isAllowed(req.method, req.url)) {
    clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    clientSocket.destroy();
    return;
  }

  const upstream = net.createConnection(DOCKER_SOCK, () => {
    let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    }
    raw += "\r\n";
    upstream.write(raw);
    if (head && head.length) upstream.write(head);
    clientSocket.pipe(upstream);
    upstream.pipe(clientSocket);
  });

  upstream.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => upstream.destroy());
});

server.on("clientError", (err, socket) => {
  if (socket.writable) socket.end();
  else socket.destroy();
});

module.exports = { isAllowed, ALLOWED, CONTAINER };

if (require.main === module) {
  try { fs.unlinkSync(PROXY_SOCK); } catch {}

  server.listen(PROXY_SOCK, () => {
    try { fs.chownSync(PROXY_SOCK, 1000, 1000); } catch {}
    fs.chmodSync(PROXY_SOCK, 0o660);
    process.stdout.write("Docker socket proxy ready\n");
  });
}
