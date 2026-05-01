/** On-disk API configuration as read from each api's config.json. */
export interface ApiConfig {
  description: string;
  domains: string[];
  credentials: Record<string, string>;
  reference?: string | null;
  restricted_methods?: string[];
  active?: boolean;
}

/** Public API metadata exposed to MCP clients (credentials are key names only). */
export interface ApiInfo {
  name: string;
  description: string;
  domains: string[];
  credentials: string[];
  reference: string | null;
  restricted_methods: string[] | null;
}

/** Result of a sandbox code execution. */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
