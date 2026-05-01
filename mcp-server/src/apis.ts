import fs from "fs";
import path from "path";
import glob from "fast-glob";
import type { ApiConfig, ApiInfo } from "./types.js";
import { log } from "./log.js";

const APIS_DIR = "/apis";
const SAFE_API_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
// RFC 1123 hostname: each label 1-63 chars, alphanumeric edges, dots between labels.
const SAFE_DOMAIN = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function resolveApiPath(apiName: string, ...segments: string[]): string | null {
  if (!SAFE_API_NAME.test(apiName)) return null;
  const resolved = path.resolve(APIS_DIR, apiName, ...segments);
  if (!resolved.startsWith(APIS_DIR + path.sep)) return null;
  return resolved;
}

interface LoadedApiConfig {
  name: string;
  config: ApiConfig;
}

// apis/ is image-baked, so configs cannot change at runtime — load once at
// module init. A malformed config crashes the server here, which is the right
// failure mode (operator must fix the file before the server can serve).
const ACTIVE_CONFIGS: LoadedApiConfig[] = (() => {
  const configs = glob.sync(path.join(APIS_DIR, "*/config.json"));
  const loaded: LoadedApiConfig[] = [];
  for (const configPath of configs) {
    const name = path.basename(path.dirname(configPath));
    if (name === "example") continue;
    const config: ApiConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (config.active === false) continue;
    loaded.push({ name, config });
  }
  return loaded;
})();

const ALL_DOMAINS: string[] = (() => {
  const domains = new Set<string>();
  for (const { name, config } of ACTIVE_CONFIGS) {
    for (const domain of config.domains) {
      if (SAFE_DOMAIN.test(domain)) {
        domains.add(domain);
      } else {
        log.error(`[apis] Rejected malformed domain "${domain}" in apis/${name}/config.json — not RFC 1123 compliant.`);
      }
    }
  }
  return Array.from(domains);
})();

const API_INFOS: ApiInfo[] = ACTIVE_CONFIGS.map(({ name, config }) => ({
  name,
  description: config.description,
  domains: config.domains,
  credentials: Object.keys(config.credentials),
  reference: config.reference ?? null,
  restricted_methods: config.restricted_methods ?? null,
}));

/** Public metadata for all configured APIs. */
export function listApis(): ApiInfo[] {
  return API_INFOS;
}

/** All allowed domains across every configured API for Deno's --allow-net flag. */
export function getAllDomains(): string[] {
  return ALL_DOMAINS;
}

/** Load and concatenate types.d.ts files for the requested APIs, or null if none exist. */
export function getTypeDefsForApis(apiNames: string[]): string | null {
  const typeDefs: string[] = [];

  for (const apiName of apiNames) {
    const typesPath = resolveApiPath(apiName, "types.d.ts");
    if (typesPath && fs.existsSync(typesPath)) {
      typeDefs.push(`// Type definitions for ${apiName}\n${fs.readFileSync(typesPath, "utf-8")}`);
    }
  }

  return typeDefs.length > 0 ? typeDefs.join("\n\n") : null;
}
