import { readFileSync } from "fs";
import { parse } from "yaml";
import { z } from "zod";
import { config } from "./config.js";

const PROMPTS_PATH = "/llm-instructions.yaml";

const PromptsSchema = z.object({
  instructions: z.object({
    preamble: z.string(),
    network: z.object({
      yolo: z.string(),
      restricted: z.string(),
    }),
  }),
  tools: z.object({
    execute_code: z.object({
      description: z.string(),
      params: z.object({
        code: z.string(),
        apis: z.string(),
        timeout: z.string(),
      }),
    }),
    list_apis: z.object({ description: z.string() }),
    get_instructions: z.object({ description: z.string() }),
    update_skill: z.object({
      description: z.string(),
      params: z.object({
        name: z.string(),
        patch: z.string(),
      }),
    }),
    delete_skill: z.object({
      description: z.string(),
      params: z.object({ name: z.string() }),
    }),
  }),
  prompts: z.object({
    run_skill: z.object({
      description: z.string(),
      params: z.object({ name: z.string() }),
    }),
  }),
});

const raw = readFileSync(PROMPTS_PATH, "utf8");
export const PROMPTS = PromptsSchema.parse(parse(raw));

const networkNote = config.yoloMode
  ? PROMPTS.instructions.network.yolo
  : PROMPTS.instructions.network.restricted;

/** Server-level instructions composed at startup: preamble + active-mode network note. */
export const INSTRUCTIONS = `${PROMPTS.instructions.preamble.trimEnd()} ${networkNote}`;
