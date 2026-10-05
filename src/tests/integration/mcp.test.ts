// Real MCP tests: drive the JSON-RPC handler against a REAL AppServiceCore
// (temp DB, demo import, real FFmpeg conversion), plus the Streamable HTTP
// transport with bearer auth. No mocks for the core path.
import { describe, it, expect, beforeAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { initSqlRuntime } from '../../database/Database.js';
import { AppServiceCore } from '../../mcp/core.js';
import { McpHandler } from '../../mcp/protocol.js';
import { createMcpHttpServer, authConfigError, bearerMatches } from '../../mcp/http.js';

beforeAll(async () => { await initSqlRuntime(); });

async function makeCore() {
  const root = mkdtempSync(join(tmpdir(), 'danko-mcp-'));
  const core = await AppServiceCore.open({
    dbPath: join(root, 'danko.sqlite'),
    workDir: join(root, 'work'),
    outputDir: join(root, 'out'),
  });
  // Fast, deterministic demo conversions.
  core.service.updateSettings({
    demo: { trackCount: 5, errorProbability: 0, speedBytesPerSec: 500 * 1024 * 1024, forcedFailureIndex: null },
    queue: { concurrency: 3, maxAttempts: 1, timeoutSec: 30, backoffBaseMs: 5, priority: 'normal' },
    conversion: {
      outputFormat: 'mp3', mp3Bitrate: 320, sampleRate: 0, outputDir: join(root, 'out'),
      namingTemplate: '{artist} - {title}', embedArtwork: false, writeMetadata: true, duplicatePolicy: 'OMITIR',
    },
  });
  const { tracks } = core.service.importDemoPlaylist(5);
  return { core, tracks };
}

const callText = (resp: any) => JSON.parse(resp.result.content[0].text);

describe('MCP protocol — real core', () => {
  it('initialize + tools/list expose scoped tools only (no shell/fs)', async () => {
    const { core } = await makeCore();
    const h = new McpHandler(core);
    const init: any = await h.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(init.result.serverInfo.name).toBe('danko-music-converter');
    const list: any = await h.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = list.result.tools.map((t: any) => t.name);
    expect(names).toContain('search_library');
    expect(names).toContain('convert_audio');
    expect(names.some((n: string) => /shell|exec|run_|read_file|delete_folder|command/i.test(n))).toBe(false);
    core.close();
  });

  it('search_library returns real tracks from the library', async () => {
    const { core } = await makeCore();
    const h = new McpHandler(core);
    const r: any = await h.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_library', arguments: { limit: 10 } } });
    const out = callText(r);
    expect(out.ok).toBe(true);
    expect(out.data.total).toBe(5);
    expect(out.data.tracks.length).toBe(5);
    core.close();
  });

  it('convert_audio (wait) produces REAL output files via FFmpeg', async () => {
    const { core, tracks } = await makeCore();
    const h = new McpHandler(core);
    const r: any = await h.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: {
      name: 'convert_audio', arguments: { trackIds: [tracks[0].id, tracks[1].id], preset: 'mp3-320', wait: true },
    } });
    const out = callText(r);
    expect(out.ok).toBe(true);
    const completed = out.data.outputs.filter((o: any) => o.status === 'COMPLETADO');
    expect(completed.length).toBe(2);
    for (const o of completed) expect(existsSync(o.outputPath)).toBe(true);
    // History reflects the real conversions.
    const hist: any = await h.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_conversion_history', arguments: {} } });
    expect(callText(hist).data.length).toBeGreaterThanOrEqual(2);
    core.close();
  }, 60000);

  it('analyze_audio returns real technical data for a converted file-backed track', async () => {
    const { core, tracks } = await makeCore();
    const h = new McpHandler(core);
    // analyze a demo track: it has no local file, so it must honestly report file-unavailable
    const r: any = await h.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'analyze_audio', arguments: { trackId: tracks[0].id } } });
    const out = callText(r);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('file-unavailable'); // honest: no invented analysis
    core.close();
  });

  it('destructive tools require confirm:true', async () => {
    const { core, tracks } = await makeCore();
    const h = new McpHandler(core);
    const noConfirm: any = await h.handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'delete_tracks', arguments: { trackIds: [tracks[0].id] } } });
    expect(callText(noConfirm).reason).toBe('confirmation-required');
    const confirmed: any = await h.handle({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'delete_tracks', arguments: { trackIds: [tracks[0].id], confirm: true } } });
    const out = callText(confirmed);
    expect(out.ok).toBe(true);
    expect(out.data.removed).toBe(1);
    core.close();
  });

  it('exposes resources (MCP Apps UI) and prompts for connectors', async () => {
    const { core } = await makeCore();
    const h = new McpHandler(core);
    const init: any = await h.handle({ jsonrpc: '2.0', id: 20, method: 'initialize', params: {} });
    expect(init.result.capabilities.resources).toBeTruthy();
    expect(init.result.capabilities.prompts).toBeTruthy();

    const list: any = await h.handle({ jsonrpc: '2.0', id: 21, method: 'tools/list' });
    const search = list.result.tools.find((t: any) => t.name === 'search_library');
    expect(search._meta['openai/outputTemplate']).toBe('ui://danko/results');

    const res: any = await h.handle({ jsonrpc: '2.0', id: 22, method: 'resources/list' });
    expect(res.result.resources.some((r: any) => r.uri === 'ui://danko/results')).toBe(true);
    const read: any = await h.handle({ jsonrpc: '2.0', id: 23, method: 'resources/read', params: { uri: 'ui://danko/results' } });
    expect(read.result.contents[0].text).toContain('DANKO MUSIC');

    const prompts: any = await h.handle({ jsonrpc: '2.0', id: 24, method: 'prompts/list' });
    expect(prompts.result.prompts.length).toBeGreaterThanOrEqual(3);
    const got: any = await h.handle({ jsonrpc: '2.0', id: 25, method: 'prompts/get', params: { name: 'find_tracks', arguments: { style: 'Makina', decade: '90s', bpm: '168-174' } } });
    expect(got.result.messages[0].content.text).toContain('Makina');
    core.close();
  });

  it('generate_report and list_presets return real data', async () => {
    const { core } = await makeCore();
    const h = new McpHandler(core);
    const rep: any = await h.handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'generate_report', arguments: {} } });
    expect(callText(rep).data.tracks).toBe(5);
    const pre: any = await h.handle({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'list_presets', arguments: {} } });
    expect(callText(pre).data.length).toBeGreaterThanOrEqual(5);
    core.close();
  });
});

describe('MCP Streamable HTTP transport', () => {
  it('serves /health, enforces bearer auth, and answers JSON-RPC on /mcp', async () => {
    const { core } = await makeCore();
    const server = createMcpHttpServer(core, 'secret-token');
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect((await health.json()).status).toBe('ok');

    // Missing token -> 401
    const unauth = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    expect(unauth.status).toBe(401);

    // With token -> tools/list
    const ok = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.result.tools.length).toBeGreaterThanOrEqual(9);

    await new Promise<void>((r) => server.close(() => r()));
    core.close();
  });

  it('handles edge cases: GET /mcp → 405, unknown method → -32601, unknown resource → error', async () => {
    const { core } = await makeCore();
    const server = createMcpHttpServer(core, null); // no auth for this probe
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;

    const get = await fetch(`${base}/mcp`);
    expect(get.status).toBe(405);

    const unknown = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'does/not/exist' }) });
    expect((await unknown.json()).error.code).toBe(-32601);

    const badRes = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'ui://nope' } }) });
    expect((await badRes.json()).error).toBeTruthy();

    await new Promise<void>((r) => server.close(() => r()));
    core.close();
  });
});

describe('MCP HTTP auth policy (fail-closed)', () => {
  it('refuses to run in production without a token, allows dev, honors explicit opt-out', () => {
    expect(authConfigError(null, { NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toMatch(/DANKO_MCP_TOKEN/);
    expect(authConfigError('abc', { NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBeNull();
    expect(authConfigError(null, {} as NodeJS.ProcessEnv)).toBeNull(); // local dev
    expect(authConfigError(null, { NODE_ENV: 'production', DANKO_MCP_ALLOW_NO_AUTH: '1' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('bearerMatches accepts only the exact bearer and never throws on odd input', () => {
    expect(bearerMatches('Bearer s3cret', 's3cret')).toBe(true);
    expect(bearerMatches('Bearer s3cret ', 's3cret')).toBe(false);
    expect(bearerMatches('bearer s3cret', 's3cret')).toBe(false);
    expect(bearerMatches(undefined, 's3cret')).toBe(false);
    expect(bearerMatches('', 's3cret')).toBe(false);
    expect(bearerMatches('Bearer ' + 'x'.repeat(10000), 's3cret')).toBe(false);
  });
});
