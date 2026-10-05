#!/usr/bin/env node
// ============================================================================
// Danko MCP — Streamable HTTP transport (for remote clients, e.g. ChatGPT).
//
//   POST /mcp     JSON-RPC 2.0 message(s)  -> JSON-RPC response
//   GET  /health  liveness probe            -> { status: "ok" }
//
// Designed to run behind HTTPS (a reverse proxy / platform TLS). When
// DANKO_MCP_TOKEN is set, every /mcp request must send `Authorization: Bearer
// <token>`. No shell, no arbitrary filesystem — only the scoped tools.
// ============================================================================
import http from 'node:http';
import process from 'node:process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { McpHandler, type JsonRpcMessage } from './protocol.js';
import { AppServiceCore, type DankoCore } from './core.js';
import { defaultCoreOptions, httpConfig } from './config.js';

/** Constant-time bearer check (hash both sides so lengths always match). */
export function bearerMatches(header: string | undefined, token: string): boolean {
  const expected = createHash('sha256').update(`Bearer ${token}`).digest();
  const actual = createHash('sha256').update(header ?? '').digest();
  return timingSafeEqual(expected, actual);
}

/**
 * Fail-closed policy: a production deployment must never run with auth off.
 * Returns an error message when the configuration is unsafe, otherwise null.
 */
export function authConfigError(token: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
  if (token) return null;
  if (env.NODE_ENV === 'production' && env.DANKO_MCP_ALLOW_NO_AUTH !== '1') {
    return 'DANKO_MCP_TOKEN is not set. Refusing to start the HTTP MCP server in production without authentication.';
  }
  return null;
}

export function createMcpHttpServer(core: DankoCore, token: string | null): http.Server {
  const handler = new McpHandler(core);

  return http.createServer((req, res) => {
    const url = req.url || '/';
    const send = (code: number, body: unknown, headers: Record<string, string> = {}) => {
      const data = typeof body === 'string' ? body : JSON.stringify(body);
      res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...headers });
      res.end(data);
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
      });
      return res.end();
    }

    if (req.method === 'GET' && (url === '/health' || url === '/healthz')) {
      return send(200, { status: 'ok', server: 'danko-music-converter', transport: 'streamable-http' });
    }

    if (url.split('?')[0] !== '/mcp') return send(404, { error: 'not found' });

    // Auth (when a token is configured).
    if (token) {
      const auth = req.headers['authorization'];
      if (!bearerMatches(typeof auth === 'string' ? auth : undefined, token)) {
        return send(401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } });
      }
    }

    if (req.method === 'GET') {
      // We do not push server-initiated events; clients use POST request/response.
      return send(405, { error: 'Use POST for JSON-RPC messages' }, { Allow: 'POST' });
    }
    if (req.method !== 'POST') return send(405, { error: 'method not allowed' }, { Allow: 'POST' });

    const MAX_BODY = 5_000_000;
    let body = '';
    let tooLarge = false;
    req.on('error', () => { /* client aborted; nothing to respond to */ });
    req.on('data', (c) => {
      if (tooLarge) return;
      body += c;
      if (body.length > MAX_BODY) {
        tooLarge = true;
        send(413, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Payload too large' } });
        req.destroy();
      }
    });
    req.on('end', async () => {
      if (tooLarge) return;
      let parsed: JsonRpcMessage | JsonRpcMessage[];
      try { parsed = JSON.parse(body); } catch {
        return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      }
      try {
        if (Array.isArray(parsed)) {
          const out = (await Promise.all(parsed.map((m) => handler.handle(m)))).filter(Boolean);
          return send(200, out);
        }
        const one = await handler.handle(parsed);
        if (!one) return res.writeHead(202, { 'Access-Control-Allow-Origin': '*' }).end();
        return send(200, one);
      } catch (e) {
        return send(500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: String((e as Error)?.message ?? e) } });
      }
    });
  });
}

// Entry point when run directly.
const isMain = !!process.argv[1] && /(?:^|\/)http\.(?:mjs|js)$/.test(process.argv[1]);
if (isMain || process.env.DANKO_MCP_HTTP_MAIN === '1') {
  const cfg = httpConfig();
  const authError = authConfigError(cfg.token);
  if (authError) {
    process.stderr.write('[danko-mcp:http] fatal: ' + authError + '\n');
    process.exit(1);
  }
  AppServiceCore.open(defaultCoreOptions()).then((core) => {
    const server = createMcpHttpServer(core, cfg.token);
    server.listen(cfg.port, cfg.host, () => {
      process.stderr.write(`[danko-mcp:http] listening on http://${cfg.host}:${cfg.port}/mcp (auth: ${cfg.token ? 'bearer' : 'off'})\n`);
    });
    const shutdown = () => { try { core.close(); } catch { /* noop */ } server.close(() => process.exit(0)); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }).catch((e) => { process.stderr.write('[danko-mcp:http] fatal: ' + String(e?.message ?? e) + '\n'); process.exit(1); });
}
