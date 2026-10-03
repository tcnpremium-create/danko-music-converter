// Shared configuration for the MCP transports. All paths are overridable by
// environment so the same server works in the desktop app, the Local Bridge,
// or a remote deployment.
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreOptions } from './core.js';

export function defaultCoreOptions(): CoreOptions {
  const base = process.env.DANKO_DATA_DIR || join(homedir(), '.danko-music-converter');
  return {
    dbPath: process.env.DANKO_DB_PATH || join(base, 'danko.sqlite'),
    workDir: process.env.DANKO_WORK_DIR || join(tmpdir(), 'danko-mcp-work'),
    outputDir: process.env.DANKO_OUTPUT_DIR || join(homedir(), 'Music', 'Danko Music Converter'),
  };
}

export interface HttpConfig {
  port: number;
  host: string;
  token: string | null; // bearer token required when set
}

export function httpConfig(): HttpConfig {
  return {
    port: Number(process.env.PORT || process.env.DANKO_MCP_PORT || 8787),
    // Default to loopback: as a Local Bridge the server must NOT be exposed to
    // the LAN. Cloud deployments set DANKO_MCP_HOST=0.0.0.0 explicitly.
    host: process.env.DANKO_MCP_HOST || '127.0.0.1',
    token: process.env.DANKO_MCP_TOKEN || null,
  };
}
