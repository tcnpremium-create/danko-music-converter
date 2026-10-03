#!/usr/bin/env node
// Smoke test for the Danko MCP server: drives the stdio JSON-RPC handshake and
// asserts the tool list, the destructive confirmation gate, and honest
// "core-not-connected" results (no fake success).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, '..', 'src', 'server.mjs');
const child = spawn(process.execPath, [server], { env: { ...process.env, DANKO_MCP_BANNER: '0' } });

const responses = [];
let buf = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (c) => {
  buf += c;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) responses.push(JSON.parse(line));
  }
});

const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');

function assert(cond, msg) { if (!cond) { console.error('✗ ' + msg); child.kill(); process.exit(1); } console.log('✓ ' + msg); }

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } });
send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'delete_tracks', arguments: { trackIds: ['x'] } } });
send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'convert_audio', arguments: { trackIds: ['x'], format: 'mp3' } } });
send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_presets', arguments: {} } });

setTimeout(() => {
  const byId = Object.fromEntries(responses.map((r) => [r.id, r]));
  assert(byId[1]?.result?.serverInfo?.name === 'danko-music-converter', 'initialize returns serverInfo');
  const tools = byId[2]?.result?.tools ?? [];
  assert(tools.length >= 9, `tools/list returns ${tools.length} scoped tools`);
  assert(!tools.some((t) => /shell|exec|read_file|delete_folder|command/i.test(t.name)),
    'no generic system-access tools exposed');
  const del = JSON.parse(byId[3].result.content[0].text);
  assert(del.ok === false && del.reason === 'confirmation-required', 'destructive tool requires confirmation');
  const conv = JSON.parse(byId[4].result.content[0].text);
  assert(conv.ok === false && conv.reason === 'core-not-connected', 'convert honestly reports core-not-connected (no fake success)');
  const presets = JSON.parse(byId[5].result.content[0].text);
  assert(presets.ok === true && presets.data.length === 5, 'list_presets returns static preset catalog');
  console.log('\nMCP smoke OK');
  child.kill();
  process.exit(0);
}, 800);
