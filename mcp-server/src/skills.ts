import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import crypto from "crypto";
import { executeInSandbox } from "./sandbox.js";
import { log } from "./log.js";
import { PROMPTS } from "./prompts.js";

const t = PROMPTS.tools;
const p = PROMPTS.prompts;

const SKILLS_DIR = "/skills";
const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const PATCH_BLOCK_RE = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;

/** Parse a SEARCH/REPLACE patch string into ordered {old, new} blocks. Returns null if no valid block is found or any SEARCH text is empty. */
function parsePatch(patch: string): Array<{ old: string; new: string }> | null {
  const blocks: Array<{ old: string; new: string }> = [];
  PATCH_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATCH_BLOCK_RE.exec(patch)) !== null) {
    if (match[1].length === 0) return null;
    blocks.push({ old: match[1], new: match[2] });
  }
  return blocks.length > 0 ? blocks : null;
}

interface SkillInfo {
  name: string;
  filename: string;
  description: string;
}

async function listSkillFiles(): Promise<SkillInfo[]> {
  const result = await executeInSandbox(
    `const skills = [];
for await (const entry of Deno.readDir("${SKILLS_DIR}")) {
  if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
  const content = await Deno.readTextFile("${SKILLS_DIR}/" + entry.name);
  const match = content.match(/@description\\s+(.+)/);
  skills.push({
    name: entry.name.replace(/\\.ts$/, ""),
    filename: entry.name,
    description: match ? match[1] : "No description",
  });
}
console.log(JSON.stringify(skills));`,
    null,
    10
  );

  if (result.exitCode !== 0 || !result.stdout.trim()) return [];
  return JSON.parse(result.stdout.trim());
}

async function readSkillSource(name: string): Promise<string | null> {
  if (!SAFE_NAME.test(name)) return null;
  const result = await executeInSandbox(
    `console.log(await Deno.readTextFile("${SKILLS_DIR}/${name}.ts"));`,
    null,
    10
  );
  if (result.exitCode !== 0) return null;
  return result.stdout;
}

/** Register skill-related MCP tools (update, delete), resources, and prompts on the given server. */
export function registerSkills(server: McpServer): void {
  // --- Resources: browse and read skills ---

  server.resource(
    "skill",
    new ResourceTemplate("skill://{name}", {
      list: async () => {
        const skills = await listSkillFiles();
        return {
          resources: skills.map((s) => ({
            uri: `skill://${s.name}`,
            name: s.name,
            description: s.description,
            mimeType: "text/typescript",
          })),
        };
      },
    }),
    async (uri, variables) => {
      const name = variables.name as string;
      const source = await readSkillSource(name);
      if (!source) {
        return { contents: [{ uri: uri.href, text: `Skill "${name}" not found.` }] };
      }
      return {
        contents: [{ uri: uri.href, text: source, mimeType: "text/typescript" }],
      };
    }
  );

  // --- Tools: update, delete ---

  server.tool(
    "update_skill",
    t.update_skill.description,
    {
      name: z.string().regex(SAFE_NAME, "Skill name must be alphanumeric with hyphens/underscores.").describe(t.update_skill.params.name),
      patch: z.string().describe(t.update_skill.params.patch),
    },
    async ({ name, patch }) => {
      const patches = parsePatch(patch);
      if (!patches) {
        return {
          content: [{
            type: "text" as const,
            text: "Patch must contain one or more SEARCH/REPLACE blocks. Format:\n<<<<<<< SEARCH\n[old]\n=======\n[new]\n>>>>>>> REPLACE",
          }],
          isError: true,
        };
      }
      log.info(`[skill] update: ${name} (${patches.length} blocks)`);
      // Write patches to a temp file to avoid code injection via string interpolation
      const patchFile = `_patches_${crypto.randomUUID()}.json`;
      const writePatches = await executeInSandbox(
        `await Deno.writeTextFile("/tmp/${patchFile}", ${JSON.stringify(JSON.stringify(patches))});`,
        null,
        5
      );
      if (writePatches.exitCode !== 0) {
        return {
          content: [{ type: "text" as const, text: "Failed to write patches." }],
          isError: true,
        };
      }

      const code = `
const path = "${SKILLS_DIR}/${name}.ts";
let source = await Deno.readTextFile(path);
const patches = JSON.parse(await Deno.readTextFile("/tmp/${patchFile}"));
for (const p of patches) {
  if (!source.includes(p.old)) {
    console.error("Patch failed: could not find: " + p.old.slice(0, 80));
    Deno.exit(1);
  }
  source = source.replace(p.old, p.new);
}
await Deno.writeTextFile(path, source);
console.log("Updated skill: ${name} (" + patches.length + " block(s) applied)");
`;
      const result = await executeInSandbox(code, null, 10);
      if (result.exitCode !== 0) {
        return {
          content: [{ type: "text" as const, text: result.stderr || "Failed to update skill." }],
          isError: true,
        };
      }
      return { content: [{ type: "text" as const, text: result.stdout.trim() }] };
    }
  );

  server.tool(
    "delete_skill",
    t.delete_skill.description,
    {
      name: z.string().regex(SAFE_NAME, "Skill name must be alphanumeric with hyphens/underscores.").describe(t.delete_skill.params.name),
    },
    async ({ name }) => {
      log.info(`[skill] delete: ${name}`);
      const result = await executeInSandbox(
        `await Deno.remove("${SKILLS_DIR}/${name}.ts"); console.log("Deleted skill: ${name}");`,
        null,
        10
      );
      if (result.exitCode !== 0) {
        return {
          content: [{ type: "text" as const, text: result.stderr || "Failed to delete skill." }],
          isError: true,
        };
      }
      return { content: [{ type: "text" as const, text: result.stdout.trim() }] };
    }
  );

  // --- Prompt: run a skill ---

  server.prompt(
    "run_skill",
    p.run_skill.description,
    { name: z.string().regex(SAFE_NAME, "Skill name must be alphanumeric with hyphens/underscores.").describe(p.run_skill.params.name) },
    async ({ name }) => {
      const source = await readSkillSource(name);
      if (!source) {
        return {
          messages: [{
            role: "user" as const,
            content: { type: "text" as const, text: `Skill "${name}" not found. Use list resources to see available skills.` },
          }],
        };
      }
      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Run this skill using execute_code:\n\n\`\`\`typescript\n${source}\`\`\``,
          },
        }],
      };
    }
  );
}
