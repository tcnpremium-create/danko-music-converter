import http from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import express, { type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { InvalidGrantError, InvalidTokenError, InvalidRequestError, InvalidClientMetadataError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

const SCOPE = 'danko:tools';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const matches = (a: string, b: string) => timingSafeEqual(Buffer.from(hash(a), 'hex'), Buffer.from(hash(b), 'hex'));
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
type Grant = { clientId: string; scopes: string[]; expires: number; family: string; kind: 'access' | 'refresh' };
type Pending = { client: OAuthClientInformationFull; params: AuthorizationParams; expires: number };
type Code = Pending & { redirect: string };
type Stored = { clients: Record<string, OAuthClientInformationFull>; grants: Record<string, Grant> };

/** Private-instance OAuth: the owner explicitly approves each client with their access key.
 * SDK handles discovery, DCR, PKCE and protocol errors. No anonymous grants.
 * State is encrypted at rest; deployment disk loss requires reconnecting, never auth bypass.
 */
export class DankoOAuthProvider implements OAuthServerProvider {
  private state: Stored = { clients: {}, grants: {} };
  private pending = new Map<string, Pending>();
  private codes = new Map<string, Code>();
  readonly resource: URL;
  readonly clientsStore = {
    getClient: (id: string) => Object.hasOwn(this.state.clients, id) ? this.state.clients[id] : undefined,
    registerClient: async (metadata: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>): Promise<OAuthClientInformationFull> => {
      if (!metadata.redirect_uris.length || metadata.redirect_uris.length > 5 || !metadata.redirect_uris.every(uri => this.allowedRedirect(uri))) {
        throw new InvalidClientMetadataError('Use an HTTPS callback on ChatGPT or Claude.');
      }
      if (Object.keys(this.state.clients).length >= 1000) throw new InvalidClientMetadataError('Registration capacity reached');
      const client = { ...metadata, client_id: randomUUID(), client_id_issued_at: Math.floor(Date.now() / 1000) };
      this.state.clients[client.client_id] = client;
      this.save();
      return client;
    },
  };

  constructor(readonly issuer: URL, private ownerKey: string, private stateFile?: string) {
    if (!ownerKey || ownerKey.length < 32) throw new Error('OAuth requires an owner access key of at least 32 characters');
    if (issuer.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(issuer.hostname)) throw new Error('OAuth issuer must use HTTPS');
    this.resource = new URL('/mcp', issuer);
    if (stateFile && existsSync(stateFile)) {
      const stored = JSON.parse(readFileSync(stateFile, 'utf8'));
      const decrypt = createDecipheriv('aes-256-gcm', createHash('sha256').update(ownerKey).digest(), Buffer.from(stored.iv, 'hex'));
      decrypt.setAuthTag(Buffer.from(stored.tag, 'hex'));
      this.state = JSON.parse(Buffer.concat([decrypt.update(Buffer.from(stored.data, 'hex')), decrypt.final()]).toString());
    }
  }

  private allowedRedirect(uri: string): boolean {
    try {
      const url = new URL(uri);
      if (url.username || url.password || url.hash) return false;
      if (['localhost', '127.0.0.1'].includes(this.issuer.hostname)) return url.protocol === 'http:' && url.hostname === '127.0.0.1';
      return url.protocol === 'https:' && !url.port && ['chatgpt.com', 'claude.ai', 'claude.com'].includes(url.hostname);
    } catch { return false; }
  }

  private save() {
    for (const [id, grant] of Object.entries(this.state.grants)) if (grant.expires < Date.now()) delete this.state.grants[id];
    if (!this.stateFile) return;
    mkdirSync(dirname(this.stateFile), { recursive: true });
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(this.ownerKey).digest(), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(this.state)), cipher.final()]);
    writeFileSync(this.stateFile + '.tmp', JSON.stringify({ iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('hex') }), { mode: 0o600 });
    renameSync(this.stateFile + '.tmp', this.stateFile);
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    if (!client.redirect_uris.includes(params.redirectUri) || !this.allowedRedirect(params.redirectUri)) throw new InvalidRequestError('Invalid callback');
    if (params.resource && params.resource.href !== this.resource.href) throw new InvalidRequestError('Invalid resource');
    if ((params.scopes ?? []).some(scope => scope !== SCOPE)) throw new InvalidRequestError('Invalid scope');
    for (const [id, value] of this.pending) if (value.expires < Date.now()) this.pending.delete(id);
    if (this.pending.size >= 100) throw new InvalidRequestError('Too many pending authorizations');
    const ticket = randomBytes(32).toString('hex');
    this.pending.set(ticket, { client, params, expires: Date.now() + 5 * 60_000 });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.type('html').send(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Conectar Danko</title><style>body{font:18px system-ui;max-width:600px;margin:10vh auto;padding:24px;background:#10151c;color:#f2f5fa}input,button{font:inherit;padding:14px;box-sizing:border-box;width:100%;margin:12px 0}button{background:#b9f257;border:0;border-radius:8px}</style><h1>Conectar Danko</h1><p>Autorizar <strong>${escape(client.client_name || 'Cliente MCP')}</strong> en <strong>${escape(new URL(params.redirectUri).hostname)}</strong>.</p><p>Este cliente podrá consultar y modificar la biblioteca de esta instancia. Las operaciones protegidas requieren confirmación. No conecta automáticamente la música de tu ordenador.</p><form method="post" action="/oauth/consent"><input type="hidden" name="ticket" value="${ticket}"><label>Clave privada de acceso de Danko<input type="password" name="access_key" autocomplete="off" required maxlength="512"></label><button type="submit">Autorizar conexión privada</button></form><p>Usa la clave guardada en Render. No la compartas con otros usuarios.</p></html>`);
  }

  consent(ticket: string, key: string): URL {
    const request = this.pending.get(ticket);
    this.pending.delete(ticket); // attempts are single-use, including wrong keys
    if (!request || request.expires < Date.now() || !matches(key, this.ownerKey)) throw new InvalidGrantError('Authorization denied or expired');
    for (const [id, code] of this.codes) if (code.expires < Date.now()) this.codes.delete(id);
    const code = randomBytes(32).toString('hex');
    this.codes.set(hash(code), { ...request, expires: Date.now() + 60_000, redirect: request.params.redirectUri });
    const target = new URL(request.params.redirectUri);
    target.searchParams.set('code', code);
    target.searchParams.set('iss', this.issuer.origin);
    if (request.params.state !== undefined) target.searchParams.set('state', request.params.state);
    return target;
  }

  private code(client: OAuthClientInformationFull, value: string): Code {
    const code = this.codes.get(hash(value));
    if (!code || code.expires < Date.now() || code.client.client_id !== client.client_id) throw new InvalidGrantError('Invalid authorization code');
    return code;
  }
  async challengeForAuthorizationCode(client: OAuthClientInformationFull, value: string) { return this.code(client, value).params.codeChallenge; }
  async exchangeAuthorizationCode(client: OAuthClientInformationFull, value: string, verifier?: string, redirect?: string, resource?: URL) {
    const code = this.code(client, value);
    // The SDK validates S256 before calling us and intentionally omits verifier.
    if ((verifier !== undefined && createHash('sha256').update(verifier).digest('base64url') !== code.params.codeChallenge) || redirect !== code.redirect || (resource && resource.href !== this.resource.href)) throw new InvalidGrantError('Invalid PKCE, callback or resource');
    this.codes.delete(hash(value));
    return this.issue(client.client_id, randomUUID());
  }
  private issue(clientId: string, family: string): OAuthTokens {
    const access = randomBytes(32).toString('hex'), refresh = randomBytes(32).toString('hex');
    this.state.grants[hash(access)] = { clientId, family, kind: 'access', scopes: [SCOPE], expires: Date.now() + 3600_000 };
    this.state.grants[hash(refresh)] = { clientId, family, kind: 'refresh', scopes: [SCOPE], expires: Date.now() + 7 * 86400_000 };
    this.save();
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600, scope: SCOPE };
  }
  async exchangeRefreshToken(client: OAuthClientInformationFull, token: string, scopes?: string[], resource?: URL) {
    const grant = this.state.grants[hash(token)];
    if (!grant || grant.kind !== 'refresh' || grant.expires < Date.now() || grant.clientId !== client.client_id || (scopes && scopes.some(scope => scope !== SCOPE)) || (resource && resource.href !== this.resource.href)) throw new InvalidGrantError('Invalid refresh token');
    delete this.state.grants[hash(token)];
    return this.issue(client.client_id, grant.family);
  }
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const grant = this.state.grants[hash(token)];
    if (!grant || grant.kind !== 'access' || grant.expires < Date.now()) throw new InvalidTokenError('Invalid or expired access token');
    return { token, clientId: grant.clientId, scopes: grant.scopes, expiresAt: Math.floor(grant.expires / 1000), resource: this.resource };
  }
  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
    const grant = this.state.grants[hash(request.token)];
    if (grant?.clientId === client.client_id) {
      for (const [key, value] of Object.entries(this.state.grants)) if (value.family === grant.family) delete this.state.grants[key];
      this.save();
    }
  }
}

export function createOAuthHttpServer(legacy: http.Server, key: string, issuer: URL, stateFile?: string): http.Server {
  const provider = new DankoOAuthProvider(issuer, key, stateFile);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render terminates TLS at its proxy
  app.use(mcpAuthRouter({ provider, issuerUrl: issuer, resourceServerUrl: provider.resource, scopesSupported: [SCOPE], resourceName: 'Danko Music Converter' }));
  app.post('/oauth/consent', rateLimit({ windowMs: 60_000, limit: 5 }), express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.headers.origin !== issuer.origin) { res.status(403).send('Origin rejected'); return; }
    try { res.redirect(303, provider.consent(String(req.body.ticket || ''), String(req.body.access_key || '')).href); }
    catch { res.status(403).send('Autorización rechazada o caducada. Reinicia la conexión.'); }
  });
  const gate = requireBearerAuth({ verifier: provider, requiredScopes: [SCOPE], expectedResource: provider.resource, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(provider.resource) });
  app.use((req, res, next) => {
    if (req.path !== '/mcp' || req.method === 'OPTIONS') { next(); return; }
    if (matches(req.headers.authorization || '', `Bearer ${key}`)) { next(); return; } // existing private API clients
    gate(req, res, () => { req.headers.authorization = `Bearer ${key}`; next(); });
  });
  app.use((req, res) => { legacy.emit('request', req, res); });
  return http.createServer(app);
}
