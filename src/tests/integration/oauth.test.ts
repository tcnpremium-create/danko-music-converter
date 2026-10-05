import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createOAuthHttpServer, DankoOAuthProvider } from '../../mcp/oauth.js';

const owner = 'private-test-owner-key-'.repeat(3);
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');

describe('Private OAuth authorization', () => {
  it('rejects foreign callbacks and never issues tokens without owner consent', async () => {
    const provider = new DankoOAuthProvider(new URL('https://danko.example'), owner);
    await expect(provider.clientsStore.registerClient({ redirect_uris: ['https://attacker.example/callback'] })).rejects.toThrow();
    await expect(provider.verifyAccessToken(owner)).rejects.toThrow();
    await expect(provider.exchangeAuthorizationCode({ client_id: 'unknown', redirect_uris: [] }, 'unknown', verifier)).rejects.toThrow();
  });

  it('runs discovery, registration, owner consent, PKCE, refresh and revocation over HTTP', async () => {
    const legacy = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"result":{"tools":[]}}'); });
    // Reserve the port so the configured issuer is exactly the one under test.
    const reservation = http.createServer();
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = (reservation.address() as AddressInfo).port;
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    const issuer = `http://127.0.0.1:${port}`;
    const stateFile = join(mkdtempSync(join(tmpdir(), 'danko-oauth-')), 'oauth.enc');
    const server = createOAuthHttpServer(legacy, owner, new URL(issuer), stateFile);
    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
    try {
      const unauth = await fetch(issuer + '/mcp', { method: 'POST' });
      expect(unauth.status).toBe(401);
      expect(unauth.headers.get('www-authenticate')).toContain('resource_metadata=');
      const resource = await (await fetch(issuer + '/.well-known/oauth-protected-resource/mcp')).json();
      expect(resource.resource).toBe(issuer + '/mcp');
      const metadata = await (await fetch(issuer + '/.well-known/oauth-authorization-server')).json();
      expect(metadata.code_challenge_methods_supported).toContain('S256');
      const registration = await fetch(metadata.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Test client', redirect_uris: [issuer + '/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
      expect(registration.status).toBe(201);
      const client = await registration.json();
      const authorize = new URL(metadata.authorization_endpoint);
      authorize.search = new URLSearchParams({ client_id: client.client_id, response_type: 'code', redirect_uri: issuer + '/callback', code_challenge: challenge, code_challenge_method: 'S256', state: 'csrf-test', scope: 'danko:tools', resource: issuer + '/mcp' }).toString();
      const page = await fetch(authorize);
      expect(page.status).toBe(200);
      const ticket = (await page.text()).match(/name="ticket" value="([a-f0-9]+)"/)![1];
      const consent = await fetch(issuer + '/oauth/consent', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: issuer }, body: new URLSearchParams({ ticket, access_key: owner }) });
      expect(consent.status).toBe(303);
      const callback = new URL(consent.headers.get('location')!);
      expect(callback.searchParams.get('state')).toBe('csrf-test');
      const code = callback.searchParams.get('code')!;
      const exchange = (value: string) => fetch(metadata.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: client.client_id, code, code_verifier: value, redirect_uri: issuer + '/callback', resource: issuer + '/mcp' }) });
      expect((await exchange('wrong-verifier')).status).toBe(400);
      const tokenResponse = await exchange(verifier);
      expect(tokenResponse.status).toBe(200);
      const tokens = await tokenResponse.json();
      expect((await exchange(verifier)).status).toBe(400); // code replay
      const call = await fetch(issuer + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + tokens.access_token } });
      expect(call.status).toBe(200);
      const stored = readFileSync(stateFile, 'utf8');
      expect(stored).not.toContain(tokens.access_token);
      expect(stored).not.toContain(owner);
      const restored = new DankoOAuthProvider(new URL(issuer), owner, stateFile);
      expect((await restored.verifyAccessToken(tokens.access_token)).clientId).toBe(client.client_id);
      const refresh = () => fetch(metadata.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token, resource: issuer + '/mcp' }) });
      const refreshedResponse = await refresh();
      expect(refreshedResponse.status).toBe(200);
      const refreshed = await refreshedResponse.json();
      expect((await refresh()).status).toBe(400); // refresh replay
      const revoke = await fetch(metadata.revocation_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: client.client_id, token: refreshed.refresh_token }) });
      expect(revoke.status).toBe(200);
      expect((await fetch(issuer + '/mcp', { headers: { Authorization: 'Bearer ' + refreshed.access_token } })).status).toBe(401);
      const page2 = await fetch(authorize);
      const ticket2 = (await page2.text()).match(/name="ticket" value="([a-f0-9]+)"/)![1];
      expect((await fetch(issuer + '/oauth/consent', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://attacker.example' }, body: new URLSearchParams({ ticket: ticket2, access_key: owner }) })).status).toBe(403);
      expect((await fetch(issuer + '/oauth/consent', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: issuer }, body: new URLSearchParams({ ticket: ticket2, access_key: 'wrong' }) })).status).toBe(403);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
