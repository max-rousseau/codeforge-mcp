import Docker from "dockerode";
import type { ExecResult } from "./types.js";
import { getAllDomains } from "./apis.js";
import { config } from "./config.js";
import { log } from "./log.js";

const docker = new Docker({ socketPath: "/var/run/codeforge.sock" });
const SANDBOX_CONTAINER = "codeforge-sandbox";

/** Execute TypeScript code in the Deno sandbox container via stdin, returning stdout, stderr, and exit code. */
export async function executeInSandbox(
  code: string,
  typeDefs: string | null,
  timeoutSeconds: number
): Promise<ExecResult> {
  const container = docker.getContainer(SANDBOX_CONTAINER);

  const fullCode = typeDefs ? `${typeDefs}\n\n${code}` : code;

  const domains = getAllDomains();
  const allowNet = config.yoloMode
    ? "--allow-net"
    : domains.length > 0
      ? `--allow-net=${domains.join(",")}`
      : "--deny-net";

  log.info(`[sandbox] exec: ${allowNet}, timeout=${timeoutSeconds}s, code=${fullCode.length} bytes`);

  // Heuristic: detect skill creation/modification via Deno.writeTextFile to /skills/.
  const skillWrites = code.matchAll(/writeTextFile\s*\(\s*["'`]\/skills\/([a-zA-Z0-9_\-]+)\.ts/g);
  for (const m of skillWrites) {
    log.info(`[skill] write: ${m[1]}.ts`);
  }

  if (config.debugMode) {
    log.info(`[sandbox] [debug] stdin:\n${fullCode}`);
  }

  let exec;
  try {
    exec = await container.exec({
      Cmd: [
        "deno", "run",
        "--ext=ts",
        allowNet,
        "--allow-read=/tmp,/skills",
        "--allow-write=/tmp,/skills",
        "-",
      ],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
    });
    log.info(`[sandbox] exec created: ${exec.id}`);
  } catch (e) {
    log.error(`[sandbox] exec create failed:`, e);
    throw e;
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      log.error(`[sandbox] timed out after ${timeoutSeconds}s`);
      reject(new Error(`Execution timed out after ${timeoutSeconds}s`));
    }, timeoutSeconds * 1000);

    exec.start({ hijack: true, stdin: true }, (err: Error | null, stream: NodeJS.ReadableStream | undefined) => {
      if (err) { clearTimeout(timeout); log.error(`[sandbox] exec start failed:`, err); return reject(err); }
      if (!stream) { clearTimeout(timeout); log.error(`[sandbox] no stream returned`); return reject(new Error("No stream returned")); }

      log.info(`[sandbox] stream attached, writing stdin`);
      const writable = stream as unknown as NodeJS.WritableStream;
      writable.write(fullCode);
      writable.end();

      let stdout = "";
      let stderr = "";

      docker.modem.demuxStream(
        stream,
        {
          write: (chunk: Buffer) => { stdout += chunk.toString(); },
        } as NodeJS.WritableStream,
        {
          write: (chunk: Buffer) => { stderr += chunk.toString(); },
        } as NodeJS.WritableStream
      );

      stream.on("error", (err: Error) => {
        clearTimeout(timeout);
        log.error(`[sandbox] stream error:`, err);
        reject(err);
      });

      stream.on("end", async () => {
        clearTimeout(timeout);
        try {
          const inspect = await exec.inspect();
          log.info(`[sandbox] done: exit=${inspect.ExitCode}, stdout=${stdout.length}b, stderr=${stderr.length}b`);
          if (config.debugMode) {
            if (stdout) log.info(`[sandbox] [debug] stdout:\n${stdout}`);
            if (stderr) log.info(`[sandbox] [debug] stderr:\n${stderr}`);
          }
          resolve({
            stdout,
            stderr,
            exitCode: inspect.ExitCode ?? 1,
          });
        } catch (e) {
          log.error(`[sandbox] inspect failed:`, e);
          reject(e);
        }
      });
    });
  });
}
