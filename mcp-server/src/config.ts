/**
 * Runtime configuration singleton. Values are read from the container environment
 * (populated by docker-compose `env_file: .env`). No defaults — every key is required
 * and missing or invalid values cause a fatal startup error.
 */

const MISSING_ENV_HINT = "Copy .env.example to .env and fill in required values.";

function requireBool(key: string): boolean {
  const raw = process.env[key];
  if (raw === undefined) {
    throw new Error(`Missing required config: ${key}. ${MISSING_ENV_HINT}`);
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`Invalid config ${key}=${raw}. Expected "true" or "false".`);
}

/** Frozen runtime configuration singleton. Evaluated at import time so the process exits fast on missing or invalid values. */
export const config = Object.freeze({
  yoloMode: requireBool("YOLO_MODE"),
  debugMode: requireBool("DEBUG_MODE"),
});
