/**
 * Tiny logger that prepends an ISO-8601 UTC timestamp to every line.
 * Use instead of bare console.log / console.error for any operational output.
 */

function ts(): string {
  return new Date().toISOString();
}

export const log = {
  info: (msg: string, ...rest: unknown[]) => console.log(`[${ts()}] ${msg}`, ...rest),
  error: (msg: string, ...rest: unknown[]) => console.error(`[${ts()}] ${msg}`, ...rest),
};
