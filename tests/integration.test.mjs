/**
 * Integration tests for CodeForge MCP server.
 * Requires the Docker Compose stack to be running (docker compose up -d).
 * Run with: node tests/integration.test.mjs
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env.MCP_URL || "http://localhost:8080/mcp";

let client;
let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}

// --- Setup ---

async function setup() {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  client = new Client({ name: "integration-test", version: "1.0.0" });
  await client.connect(transport);
}

// --- Tests ---

async function testInitialize() {
  await test("server reports correct identity", () => {
    assert(client.getServerVersion().name === "codeforge", "server name must be 'codeforge'");
  });
}

async function testToolsList() {
  const expected = ["execute_code", "list_apis", "update_skill", "delete_skill"];

  await test("tools/list returns all expected tools", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    const missing = expected.filter((n) => !names.includes(n));
    assert(missing.length === 0, `missing tools: ${missing.join(", ")}`);
  });

  await test("each tool has a description and input schema", async () => {
    const result = await client.listTools();
    for (const tool of result.tools) {
      assert(tool.description && tool.description.length > 0, `${tool.name} missing description`);
      assert(tool.inputSchema, `${tool.name} missing inputSchema`);
    }
  });
}

async function testListApis() {
  await test("list_apis returns valid JSON array", async () => {
    const result = await client.callTool({ name: "list_apis", arguments: {} });
    const text = result.content[0].text;
    const apis = JSON.parse(text);
    assert(Array.isArray(apis), "list_apis must return an array");
  });

  await test("each api entry has required fields", async () => {
    const result = await client.callTool({ name: "list_apis", arguments: {} });
    const apis = JSON.parse(result.content[0].text);
    for (const api of apis) {
      assert(api.name, "api missing name");
      assert(api.description, "api missing description");
      assert(Array.isArray(api.domains), "api missing domains array");
      assert(Array.isArray(api.credentials), "api missing credentials array");
      assert("reference" in api, "api missing reference field");
      assert("restricted_methods" in api, "api missing restricted_methods field");
    }
  });

}

async function testExecuteCode() {
  await test("execute_code runs basic TypeScript", async () => {
    const result = await client.callTool({
      name: "execute_code",
      arguments: { code: "console.log('hello from sandbox');" },
    });
    assert(!result.isError, `execution failed: ${JSON.stringify(result.content)}`);
    const output = result.content[0].text;
    assert(output.includes("hello from sandbox"), `unexpected output: ${output}`);
  });

  await test("execute_code reports errors for bad code", async () => {
    const result = await client.callTool({
      name: "execute_code",
      arguments: { code: "throw new Error('intentional');" },
    });
    assert(result.isError === true, "bad code must set isError");
  });

  await test("execute_code respects timeout", async () => {
    const result = await client.callTool({
      name: "execute_code",
      arguments: { code: "await new Promise(() => {});", timeout: 3 },
    });
    assert(result.isError === true, "infinite loop must timeout");
  });
}

async function testResourcesList() {
  await test("resources/list returns skill resource template", async () => {
    const result = await client.listResourceTemplates();
    const skill = result.resourceTemplates.find((r) => r.uriTemplate.includes("skill://"));
    assert(skill, "must have a skill resource template");
  });
}

async function testPromptsList() {
  await test("prompts/list includes run_skill", async () => {
    const result = await client.listPrompts();
    const runSkill = result.prompts.find((p) => p.name === "run_skill");
    assert(runSkill, "must have run_skill prompt");
  });
}

// --- Runner ---

async function run() {
  console.log(`\nCodeForge Integration Tests`);
  console.log(`Target: ${MCP_URL}\n`);

  try {
    await setup();
  } catch (err) {
    console.error(`FATAL: Could not connect to MCP server at ${MCP_URL}`);
    console.error(`       Is the Docker Compose stack running? (docker compose up -d)`);
    console.error(`       ${err.message}`);
    process.exit(1);
  }

  await testInitialize();
  await testToolsList();
  await testListApis();
  await testExecuteCode();
  await testResourcesList();
  await testPromptsList();

  console.log(`\n${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.error}`);
    }
  }

  await client.close();
  process.exit(failed > 0 ? 1 : 0);
}

run();
