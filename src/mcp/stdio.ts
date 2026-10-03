#!/usr/bin/env node
// ============================================================================
// Danko MCP — stdio transport (for Claude Desktop/Code and local dev).
// Newline-delimited JSON-RPC 2.0 over stdin/stdout.
// ============================================================================
import process from 'node:process';
import { McpHandler } from './protocol.js';
import { AppServiceCore } from './core.js';
import { defaultCoreOptions } from './config.js';

async function main() {
  const core = await AppServiceCore.open(defaultCoreOptions());
  const handler = new McpHandler(core);

  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      handler.handle(msg).then((res) => {
        if (res) process.stdout.write(JSON.stringify(res) + '\n');
      }).catch((e) => {
        if (msg?.id !== undefined) {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(e?.message ?? e) } }) + '\n');
        }
      });
    }
  });
  process.stdin.on('end', () => { core.close(); process.exit(0); });

  if (process.env.DANKO_MCP_BANNER !== '0') {
    process.stderr.write('[danko-mcp:stdio] ready\n');
  }
}

main().catch((e) => { process.stderr.write('[danko-mcp:stdio] fatal: ' + String(e?.message ?? e) + '\n'); process.exit(1); });
