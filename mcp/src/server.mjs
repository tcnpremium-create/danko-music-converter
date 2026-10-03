#!/usr/bin/env node
// ============================================================================
// Danko Music Converter — MCP server (stdio transport, JSON-RPC 2.0).
//
// Dependency-free skeleton that implements the Model Context Protocol stdio
// handshake (initialize / tools/list / tools/call). It exposes ONLY the scoped
// Danko tools from tools.mjs and enforces a confirmation gate on destructive
// tools. It never shells out and never touches arbitrary files.
//
// Swap createCore() for a real adapter to connect it to the running app.
// ============================================================================
import process from 'node:process';
import { TOOLS, TOOLS_BY_NAME } from './tools.mjs';
import { createCore } from './core.mjs';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'danko-music-converter', version: '1.0.0' };
const core = createCore();

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}
function result(id, res) { send({ jsonrpc: '2.0', id, result: res }); }
function error(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

function listTools() {
  return {
    tools: TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: {
        readOnlyHint: !t.destructive && ['search_library', 'get_track_metadata',
          'analyze_audio', 'get_conversion_history', 'list_presets', 'generate_report']
          .includes(t.name),
        destructiveHint: !!t.destructive,
      },
    })),
  };
}

async function callTool(id, params) {
  const name = params?.name;
  const args = params?.arguments ?? {};
  const tool = TOOLS_BY_NAME[name];
  if (!tool) return error(id, -32602, `Unknown tool: ${name}`);

  // Safety gate: destructive tools require explicit confirmation.
  if (tool.destructive && args.confirm !== true) {
    return result(id, {
      isError: true,
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: false,
          reason: 'confirmation-required',
          message: `"${name}" is a destructive operation. Re-call with "confirm": true to proceed.`,
        }),
      }],
    });
  }

  let res;
  try {
    res = await core[tool.handler](args);
  } catch (e) {
    return result(id, {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ ok: false, reason: 'core-error', message: String(e?.message ?? e) }) }],
    });
  }
  return result(id, {
    isError: res?.ok === false,
    content: [{ type: 'text', text: JSON.stringify(res) }],
  });
}

async function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    case 'notifications/initialized':
      return; // notification, no response
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(id, listTools());
    case 'tools/call':
      return callTool(id, params);
    default:
      if (id !== undefined) error(id, -32601, `Method not found: ${method}`);
  }
}

// Newline-delimited JSON-RPC over stdin.
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    Promise.resolve(handle(msg)).catch((e) => {
      if (msg?.id !== undefined) error(msg.id, -32603, String(e?.message ?? e));
    });
  }
});
process.stdin.on('end', () => process.exit(0));

if (process.env.DANKO_MCP_BANNER !== '0') {
  process.stderr.write('[danko-mcp] ready (stdio). Tools: ' + TOOLS.map((t) => t.name).join(', ') + '\n');
}
