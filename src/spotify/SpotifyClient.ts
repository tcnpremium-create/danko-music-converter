// Spotify Web API integration for desktop: metadata + playlist import only.
// Audio is always resolved from local files already present on disk.
// No Spotify audio/stream capture is performed.
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { safeStorage } from 'electron';
import { URL } from 'node:url';
import { shell } from 'electron';

const API = 'https://api.spotify.com/v1';
const TOKEN = 'https://accounts.spotify.com/api/token';
const REDIRECT_URI = 'http://127.0.0.1:8974/callback';
const SCOPES = 'playlist-read-private playlist-read-collaborative';

type SpotifyImage = { url: string; width: number | null; height: number | null };
type SpotifyTrack = {
  id: string;
  name: string;
  duration_ms: number;
  track_number: number;
  disc_number: number;
  external_urls?: { spotify?: string };
  artists: { name: string }[];
  album: { name: string; images?: SpotifyImage[]; artists?: { name: string }[] };
};
type PlaylistItem = { item?: SpotifyTrack | null; is_local?: boolean };
type Page = { items: PlaylistItem[]; next: string | null; total: number };
type PlaylistResponse = {
  id: string;
  name: string;
  images?: SpotifyImage[];
  external_urls?: { spotify?: string };
  items?: { total: number };
};

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function parsePlaylistId(input: string): string {
  const raw = input.trim();
  const m = raw.match(/spotify\.com\/playlist\/([A-Za-z0-9]+)|^([A-Za-z0-9]{10,})$/i);
  const id = m?.[1] ?? m?.[2];
  if (!id) throw new Error('URL de playlist de Spotify no válida');
  return id;
}

export class SpotifyClient {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private refreshToken: string | null = null;

  constructor(private readonly clientId: string, private readonly tokenPath: string) {
    try {
      if (existsSync(tokenPath) && safeStorage.isEncryptionAvailable()) {
        this.refreshToken = safeStorage.decryptString(readFileSync(tokenPath));
      }
    } catch { this.refreshToken = null; }

    if (!clientId.trim()) throw new Error('Falta configurar el Spotify Client ID en Configuración → Spotify.');
  }

  private async authorize(): Promise<void> {
    const verifier = base64url(randomBytes(48));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    const state = base64url(randomBytes(24));

    const code = await new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        try {
          const u = new URL(req.url ?? '/', REDIRECT_URI);
          if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
          if (u.searchParams.get('state') !== state) {
            res.writeHead(400); res.end('Estado OAuth inválido'); reject(new Error('Spotify OAuth state mismatch')); return;
          }
          const error = u.searchParams.get('error');
          const authCode = u.searchParams.get('code');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body><h2>DANKO Audio Converter</h2><p>Spotify autorizado. Puedes volver a la aplicación.</p><script>window.close()</script></body></html>');
          server.close();
          if (error) reject(new Error(`Spotify rechazó la autorización: ${error}`));
          else if (authCode) resolve(authCode);
          else reject(new Error('Spotify no devolvió un código de autorización'));
        } catch (e) { reject(e); }
      });
      server.once('error', (e) => reject(new Error(`No se pudo abrir el callback OAuth: ${String(e)}`)));
      server.listen(8974, '127.0.0.1', () => {
        const auth = new URL('https://accounts.spotify.com/authorize');
        auth.search = new URLSearchParams({
          response_type: 'code',
          client_id: this.clientId,
          scope: SCOPES,
          redirect_uri: REDIRECT_URI,
          code_challenge_method: 'S256',
          code_challenge: challenge,
          state,
        }).toString();
        void shell.openExternal(auth.toString());
      });
    });

    const body = new URLSearchParams({
      client_id: this.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    });
    const r = await fetch(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!r.ok) throw new Error(`Spotify token error HTTP ${r.status}`);
    const token = await r.json() as { access_token: string; expires_in: number; refresh_token?: string };
    this.accessToken = token.access_token;
    this.refreshToken = token.refresh_token ?? this.refreshToken;
    this.expiresAt = Date.now() + Math.max(30, token.expires_in - 60) * 1000;
    this.persistRefreshToken();
  }

  private persistRefreshToken(): void {
    try {
      if (this.refreshToken && safeStorage.isEncryptionAvailable()) {
        writeFileSync(this.tokenPath, safeStorage.encryptString(this.refreshToken), { mode: 0o600 });
      }
    } catch { /* se vuelve a autorizar en la próxima sesión */ }
  }

  private async refreshAccessToken(): Promise<boolean> {
    if (!this.refreshToken) return false;
    try {
      const body = new URLSearchParams({ client_id: this.clientId, grant_type: 'refresh_token', refresh_token: this.refreshToken });
      const r = await fetch(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      if (!r.ok) return false;
      const token = await r.json() as { access_token: string; expires_in: number; refresh_token?: string };
      this.accessToken = token.access_token;
      if (token.refresh_token) this.refreshToken = token.refresh_token;
      this.expiresAt = Date.now() + Math.max(30, token.expires_in - 60) * 1000;
      this.persistRefreshToken();
      return true;
    } catch { return false; }
  }

  private async request<T>(url: string): Promise<T> {
    if (!this.accessToken || Date.now() >= this.expiresAt) {
      if (!(await this.refreshAccessToken())) await this.authorize();
    }
    const r = await fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}` } });
    if (r.status === 401) {
      this.accessToken = null;
      await this.authorize();
      return this.request<T>(url);
    }
    if (r.status === 403) throw new Error('Spotify no permite leer esta playlist con la cuenta autorizada. Actualmente la API requiere que seas propietario o colaborador de la playlist.');
    if (r.status === 429) throw new Error('Spotify ha limitado temporalmente las peticiones. Espera unos segundos y vuelve a intentarlo.');
    if (!r.ok) throw new Error(`Spotify API HTTP ${r.status}`);
    return r.json() as Promise<T>;
  }

  async getPlaylist(input: string): Promise<{ playlist: PlaylistResponse; tracks: SpotifyTrack[] }> {
    const id = parsePlaylistId(input);
    const playlist = await this.request<PlaylistResponse>(`${API}/playlists/${id}?market=ES`);
    const tracks: SpotifyTrack[] = [];
    let next = `${API}/playlists/${id}/items?market=ES&limit=50`;
    while (next) {
      const page = await this.request<Page>(next);
      for (const item of page.items ?? []) {
        if (item.is_local || !item.item?.id || !item.item.name) continue;
        tracks.push(item.item);
      }
      next = page.next ?? '';
    }
    return { playlist, tracks };
  }
}
