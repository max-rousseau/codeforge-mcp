import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeInSandbox } from "./sandbox.js";
import { listApis, getTypeDefsForApis } from "./apis.js";
import { PROMPTS, INSTRUCTIONS } from "./prompts.js";


const DEFAULT_TIMEOUT = 60;
const t = PROMPTS.tools;

/** Register all MCP tools (execute_code, list_apis, get_instructions) on the given server. */
export function registerTools(server: McpServer): void {
  server.tool(
    "get_instructions",
    t.get_instructions.description,
    {},
    async () => ({
      content: [{ type: "text" as const, text: INSTRUCTIONS }],
    }),
  );

  server.tool(
    "execute_code",
    t.execute_code.description,
    {
      code: z.string().describe(t.execute_code.params.code),
      apis: z.array(z.string()).optional().describe(t.execute_code.params.apis),
      timeout: z.number().optional().describe(t.execute_code.params.timeout),
    },
    async ({ code, apis, timeout }) => {
      const typeDefs = apis ? getTypeDefsForApis(apis) : null;

      try {
        const result = await executeInSandbox(code, typeDefs, timeout ?? DEFAULT_TIMEOUT);

        if (result.exitCode !== 0) {
          return {
            content: [
              { type: "text" as const, text: `${result.stderr}\n${result.stdout}`.trim() },
            ],
            isError: true,
          };
        }

        return {
          content: [
            { type: "text" as const, text: result.stdout },
          ],
          isError: false,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: message }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "list_apis",
    t.list_apis.description,
    {},
    async () => {
      const apis = listApis();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(apis) }],
      };
    }
  );

}
