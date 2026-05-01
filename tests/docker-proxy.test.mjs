/**
 * Unit tests for the Docker socket proxy matcher (mcp-server/docker-proxy.cjs).
 * Imports the pure isAllowed(method, path) function and tests it directly —
 * no subprocesses, no sockets, no temp files.
 * Run with: node tests/docker-proxy.test.mjs
 */

import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { isAllowed } = require("../mcp-server/docker-proxy.cjs");

// HTTP-parser malformed-input tests dropped — those exercised Node's http module, not our matcher.

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}

console.log("\nDocker Socket Proxy Tests\n");

// --- Allowed routes ---

test("allows POST /containers/codeforge-sandbox/exec (no version)", () => {
  assert(isAllowed("POST", "/containers/codeforge-sandbox/exec"), "should be allowed");
});

test("allows POST /v1.47/containers/codeforge-sandbox/exec", () => {
  assert(isAllowed("POST", "/v1.47/containers/codeforge-sandbox/exec"), "should be allowed");
});

test("allows POST /v1.44/exec/{id}/start", () => {
  assert(isAllowed("POST", "/v1.44/exec/a1b2c3d4e5f6/start"), "should be allowed");
});

test("allows POST /exec/{id}/start (no version)", () => {
  assert(isAllowed("POST", "/exec/abcdef0123456789/start"), "should be allowed");
});

test("allows GET /v1.44/exec/{id}/json", () => {
  assert(isAllowed("GET", "/v1.44/exec/a1b2c3d4e5f6/json"), "should be allowed");
});

test("allows GET /exec/{id}/json (no version)", () => {
  assert(isAllowed("GET", "/exec/abcdef0123456789/json"), "should be allowed");
});

// --- Wrong container ---

test("blocks exec on different container name", () => {
  assert(!isAllowed("POST", "/v1.44/containers/evil-container/exec"), "should be blocked");
});

test("blocks exec on partial container name match", () => {
  assert(!isAllowed("POST", "/v1.44/containers/codeforge-sandbox-evil/exec"), "should be blocked");
});

test("blocks exec on container name prefix", () => {
  assert(!isAllowed("POST", "/v1.44/containers/codeforge/exec"), "should be blocked");
});

// --- Blocked Docker API routes ---

test("blocks GET /containers/json (list containers)", () => {
  assert(!isAllowed("GET", "/v1.44/containers/json"), "should be blocked");
});

test("blocks POST /containers/create", () => {
  assert(!isAllowed("POST", "/v1.44/containers/create"), "should be blocked");
});

test("blocks DELETE /containers/codeforge-sandbox", () => {
  assert(!isAllowed("DELETE", "/v1.44/containers/codeforge-sandbox"), "should be blocked");
});

test("blocks GET /images/json (list images)", () => {
  assert(!isAllowed("GET", "/v1.44/images/json"), "should be blocked");
});

test("blocks POST /volumes/create", () => {
  assert(!isAllowed("POST", "/v1.44/volumes/create"), "should be blocked");
});

test("blocks GET /networks (list networks)", () => {
  assert(!isAllowed("GET", "/v1.44/networks"), "should be blocked");
});

test("blocks POST /containers/codeforge-sandbox/stop", () => {
  assert(!isAllowed("POST", "/v1.44/containers/codeforge-sandbox/stop"), "should be blocked");
});

test("blocks POST /containers/codeforge-sandbox/kill", () => {
  assert(!isAllowed("POST", "/v1.44/containers/codeforge-sandbox/kill"), "should be blocked");
});

test("blocks GET /info (Docker system info)", () => {
  assert(!isAllowed("GET", "/v1.44/info"), "should be blocked");
});

// --- Wrong HTTP method for allowed paths ---

test("blocks GET on exec create path", () => {
  assert(!isAllowed("GET", "/v1.44/containers/codeforge-sandbox/exec"), "should be blocked");
});

test("blocks DELETE on exec create path", () => {
  assert(!isAllowed("DELETE", "/v1.44/containers/codeforge-sandbox/exec"), "should be blocked");
});

test("blocks GET on exec start path", () => {
  assert(!isAllowed("GET", "/v1.44/exec/a1b2c3d4e5f6/start"), "should be blocked");
});

test("blocks POST on exec inspect path", () => {
  assert(!isAllowed("POST", "/v1.44/exec/a1b2c3d4e5f6/json"), "should be blocked");
});

// --- Exec ID validation ---

test("blocks exec start with non-hex ID", () => {
  assert(!isAllowed("POST", "/v1.44/exec/ZZZZZZ/start"), "should be blocked");
});

test("blocks exec start with path traversal in ID", () => {
  assert(!isAllowed("POST", "/v1.44/exec/../../etc/passwd/start"), "should be blocked");
});

test("blocks exec inspect with non-hex ID", () => {
  assert(!isAllowed("GET", "/v1.44/exec/not-a-hex-id/json"), "should be blocked");
});

// --- Trailing slash / query string injection ---

test("blocks path with trailing slash", () => {
  assert(!isAllowed("POST", "/v1.44/containers/codeforge-sandbox/exec/"), "should be blocked");
});

test("blocks path with query string injection", () => {
  assert(!isAllowed("POST", "/v1.44/containers/codeforge-sandbox/exec?extra=bad"), "should be blocked");
});

console.log(`\n${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.error}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
