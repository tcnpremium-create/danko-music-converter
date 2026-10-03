// ============================================================================
// Capa de acceso a datos sobre sql.js (SQLite en WASM), persistida a disco.
// Diseñada para ser testeable: acepta una ruta de fichero o ':memory:'.
// ============================================================================
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS } from './schema.js';
import type {
  Playlist, Track, Job, HistoryEntry, JobStatus,
} from '../types/index.js';

let SQL: SqlJsStatic | null = null;

/** Inicializa el runtime WASM de sql.js una sola vez. `locateFile` permite
 *  apuntar al .wasm empaquetado dentro de resources en producción. */
export async function initSqlRuntime(locateFile?: (f: string) => string): Promise<void> {
  if (SQL) return;
  SQL = await initSqlJs(locateFile ? { locateFile } : undefined);
}

export class Database {
  private db: SqlJsDatabase;
  private readonly path: string | null;

  private constructor(db: SqlJsDatabase, path: string | null) {
    this.db = db;
    this.path = path;
  }

  static async open(path: string | ':memory:'): Promise<Database> {
    if (!SQL) throw new Error('initSqlRuntime() debe llamarse antes de open()');
    const filePath = path === ':memory:' ? null : path;
    let db: SqlJsDatabase;
    if (filePath && existsSync(filePath)) {
      db = new SQL.Database(readFileSync(filePath));
    } else {
      if (filePath) mkdirSync(dirname(filePath), { recursive: true });
      db = new SQL.Database();
    }
    db.run('PRAGMA foreign_keys = ON;');
    const instance = new Database(db, filePath);
    instance.migrate();
    instance.persist();
    return instance;
  }

  /** Aplica migraciones pendientes según PRAGMA user_version. */
  private migrate(): void {
    const current = this.userVersion();
    for (const m of MIGRATIONS) {
      if (m.version > current) {
        this.db.exec('BEGIN;');
        try {
          this.db.run(m.sql);
          this.db.run(`PRAGMA user_version = ${m.version};`);
          this.db.exec('COMMIT;');
        } catch (e) {
          this.db.exec('ROLLBACK;');
          throw e;
        }
      }
    }
  }

  private userVersion(): number {
    const res = this.db.exec('PRAGMA user_version;');
    return (res[0]?.values[0]?.[0] as number) ?? 0;
  }

  get version(): number {
    return this.userVersion();
  }

  /** Escribe la base a disco de forma atómica (tmp + rename). No-op en memoria. */
  persist(): void {
    if (!this.path) return;
    const data = Buffer.from(this.db.export());
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, data);
    renameSync(tmp, this.path);
  }

  close(): void {
    this.persist();
    this.db.close();
  }

  // -- helpers internos --------------------------------------------------------

  /** sql.js requiere que las claves de parámetros nombrados incluyan el sigilo ":". */
  private static prefix(params: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) {
      out[k.startsWith(':') ? k : `:${k}`] = v ?? null;
    }
    return out;
  }

  private run(sql: string, params: Record<string, unknown> = {}): void {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(Database.prefix(params) as never);
      stmt.step();
    } finally {
      stmt.free();
    }
  }

  private all<T>(sql: string, params: Record<string, unknown> = {}): T[] {
    const stmt = this.db.prepare(sql);
    const rows: T[] = [];
    try {
      stmt.bind(Database.prefix(params) as never);
      while (stmt.step()) rows.push(stmt.getAsObject() as unknown as T);
    } finally {
      stmt.free();
    }
    return rows;
  }

  // -- Playlists ---------------------------------------------------------------

  upsertPlaylist(p: Playlist): void {
    this.run(
      `INSERT INTO playlists (id,name,provider,artworkPath,trackCount,totalDuration,estimatedBytes,createdAt)
       VALUES (:id,:name,:provider,:artworkPath,:trackCount,:totalDuration,:estimatedBytes,:createdAt)
       ON CONFLICT(id) DO UPDATE SET name=:name, provider=:provider, artworkPath=:artworkPath,
         trackCount=:trackCount, totalDuration=:totalDuration, estimatedBytes=:estimatedBytes`,
      {
        id: p.id, name: p.name, provider: p.provider, artworkPath: p.artworkPath ?? null,
        trackCount: p.trackCount, totalDuration: p.totalDurationSec,
        estimatedBytes: p.estimatedBytes, createdAt: p.createdAt,
      },
    );
  }

  getPlaylists(): Playlist[] {
    return this.all<Record<string, unknown>>('SELECT * FROM playlists ORDER BY createdAt DESC')
      .map(this.rowToPlaylist);
  }

  getPlaylist(id: string): Playlist | null {
    const r = this.all<Record<string, unknown>>('SELECT * FROM playlists WHERE id=:id', { id });
    return r[0] ? this.rowToPlaylist(r[0]) : null;
  }

  /** Elimina la playlist y, en cascada, sus pistas y sus jobs. */
  deletePlaylist(id: string): void {
    this.run('DELETE FROM jobs WHERE playlistId=:id', { id });
    this.run('DELETE FROM tracks WHERE playlistId=:id', { id });
    this.run('DELETE FROM playlists WHERE id=:id', { id });
  }

  private rowToPlaylist = (r: Record<string, unknown>): Playlist => ({
    id: r.id as string, name: r.name as string, provider: r.provider as Playlist['provider'],
    artworkPath: (r.artworkPath as string) ?? undefined, trackCount: r.trackCount as number,
    totalDurationSec: r.totalDuration as number, estimatedBytes: r.estimatedBytes as number,
    createdAt: r.createdAt as number,
  });

  // -- Tracks ------------------------------------------------------------------

  insertTrack(t: Track, dupHash: string): void {
    this.run(
      `INSERT OR REPLACE INTO tracks
       (id,playlistId,position,title,artist,album,albumArtist,genre,year,trackNumber,discNumber,
        comment,composer,isrc,artworkPath,durationSec,sourceFormat,sourcePath,provider,estimatedBytes,dupHash)
       VALUES (:id,:playlistId,:position,:title,:artist,:album,:albumArtist,:genre,:year,:trackNumber,
        :discNumber,:comment,:composer,:isrc,:artworkPath,:durationSec,:sourceFormat,:sourcePath,:provider,:estimatedBytes,:dupHash)`,
      {
        id: t.id, playlistId: t.playlistId, position: t.position,
        title: t.metadata.title, artist: t.metadata.artist, album: t.metadata.album,
        albumArtist: t.metadata.albumArtist ?? null, genre: t.metadata.genre ?? null,
        year: t.metadata.year ?? null, trackNumber: t.metadata.trackNumber ?? null,
        discNumber: t.metadata.discNumber ?? null, comment: t.metadata.comment ?? null,
        composer: t.metadata.composer ?? null, isrc: t.metadata.isrc ?? null,
        artworkPath: t.metadata.artworkPath ?? null, durationSec: t.durationSec,
        sourceFormat: t.sourceFormat, sourcePath: t.sourcePath ?? null, provider: t.provider,
        estimatedBytes: t.estimatedBytes, dupHash,
      },
    );
  }

  getTracks(playlistId: string): Track[] {
    return this.all<Record<string, unknown>>(
      'SELECT * FROM tracks WHERE playlistId=:pid ORDER BY position', { pid: playlistId },
    ).map(this.rowToTrack);
  }

  getTrack(id: string): Track | null {
    const r = this.all<Record<string, unknown>>('SELECT * FROM tracks WHERE id=:id', { id });
    return r[0] ? this.rowToTrack(r[0]) : null;
  }

  deleteTrack(id: string): void {
    this.run('DELETE FROM tracks WHERE id=:id', { id });
  }

  countTracks(): number {
    const r = this.all<{ n: number }>('SELECT COUNT(*) AS n FROM tracks');
    return r[0]?.n ?? 0;
  }

  /** Agregados del historial para el dashboard. */
  historyStats(): { total: number; completed: number; errors: number; bytes: number } {
    const r = this.all<{ total: number; completed: number; errors: number; bytes: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN result='COMPLETADO' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN result='ERROR' THEN 1 ELSE 0 END) AS errors,
              COALESCE(SUM(CASE WHEN result='COMPLETADO' THEN bytes ELSE 0 END),0) AS bytes
       FROM history`,
    );
    const row = r[0] ?? { total: 0, completed: 0, errors: 0, bytes: 0 };
    return {
      total: row.total ?? 0, completed: row.completed ?? 0,
      errors: row.errors ?? 0, bytes: row.bytes ?? 0,
    };
  }

  /** Todas las pistas con archivo local en disco (candidatas a matching). */
  getAllLocalTracks(): Track[] {
    return this.all<Record<string, unknown>>(
      "SELECT * FROM tracks WHERE sourcePath IS NOT NULL AND sourcePath != '' ORDER BY artist, title",
    ).map(this.rowToTrack);
  }

  /** Todas las pistas de la biblioteca (para búsqueda del MCP). */
  getAllTracks(): Track[] {
    return this.all<Record<string, unknown>>(
      'SELECT * FROM tracks ORDER BY artist, title',
    ).map(this.rowToTrack);
  }

  getTrackById(id: string): Track | null {
    return this.getTrack(id);
  }

  /** ¿Existe ya otra pista con el mismo hash de duplicado? */
  countByDupHash(dupHash: string, excludeTrackId?: string): number {
    const r = this.all<{ n: number }>(
      'SELECT COUNT(*) AS n FROM tracks WHERE dupHash=:h AND id != :ex',
      { h: dupHash, ex: excludeTrackId ?? '' },
    );
    return r[0]?.n ?? 0;
  }

  private rowToTrack = (r: Record<string, unknown>): Track => ({
    id: r.id as string, playlistId: r.playlistId as string, position: r.position as number,
    metadata: {
      title: r.title as string, artist: r.artist as string, album: r.album as string,
      albumArtist: (r.albumArtist as string) ?? undefined, genre: (r.genre as string) ?? undefined,
      year: (r.year as number) ?? undefined, trackNumber: (r.trackNumber as number) ?? undefined,
      discNumber: (r.discNumber as number) ?? undefined, comment: (r.comment as string) ?? undefined,
      composer: (r.composer as string) ?? undefined, isrc: (r.isrc as string) ?? undefined,
      artworkPath: (r.artworkPath as string) ?? undefined,
    },
    durationSec: r.durationSec as number, sourceFormat: r.sourceFormat as Track['sourceFormat'],
    sourcePath: (r.sourcePath as string) ?? undefined, provider: r.provider as Track['provider'],
    estimatedBytes: r.estimatedBytes as number,
  });

  // -- Jobs --------------------------------------------------------------------

  upsertJob(j: Job): void {
    this.run(
      `INSERT INTO jobs (id,playlistId,trackId,status,progress,attempts,maxAttempts,nextAttemptAt,
         error,outputPath,outputBytes,createdAt,updatedAt)
       VALUES (:id,:playlistId,:trackId,:status,:progress,:attempts,:maxAttempts,:nextAttemptAt,
         :error,:outputPath,:outputBytes,:createdAt,:updatedAt)
       ON CONFLICT(id) DO UPDATE SET status=:status, progress=:progress, attempts=:attempts,
         maxAttempts=:maxAttempts, nextAttemptAt=:nextAttemptAt, error=:error, outputPath=:outputPath,
         outputBytes=:outputBytes, updatedAt=:updatedAt`,
      {
        id: j.id, playlistId: j.playlistId, trackId: j.trackId, status: j.status,
        progress: j.progress, attempts: j.attempts, maxAttempts: j.maxAttempts,
        nextAttemptAt: j.nextAttemptAt, error: j.error, outputPath: j.outputPath,
        outputBytes: j.outputBytes, createdAt: j.createdAt, updatedAt: j.updatedAt,
      },
    );
  }

  getJobs(playlistId?: string): Job[] {
    const sql = playlistId
      ? 'SELECT * FROM jobs WHERE playlistId=:pid ORDER BY createdAt'
      : 'SELECT * FROM jobs ORDER BY createdAt';
    return this.all<Record<string, unknown>>(sql, playlistId ? { pid: playlistId } : {})
      .map(this.rowToJob);
  }

  /** Jobs no terminales (para recuperación tras cierre inesperado). */
  getUnfinishedJobs(): Job[] {
    const active: JobStatus[] = ['PENDIENTE', 'ANALIZANDO', 'PROCESANDO', 'REINTENTANDO'];
    const placeholders = active.map((_, i) => `:s${i}`).join(',');
    const params: Record<string, unknown> = {};
    active.forEach((s, i) => (params[`s${i}`] = s));
    return this.all<Record<string, unknown>>(
      `SELECT * FROM jobs WHERE status IN (${placeholders}) ORDER BY createdAt`, params,
    ).map(this.rowToJob);
  }

  deleteJobs(playlistId: string): void {
    this.run('DELETE FROM jobs WHERE playlistId=:pid', { pid: playlistId });
  }

  deleteJob(id: string): void {
    this.run('DELETE FROM jobs WHERE id=:id', { id });
  }

  private rowToJob = (r: Record<string, unknown>): Job => ({
    id: r.id as string, playlistId: r.playlistId as string, trackId: r.trackId as string,
    status: r.status as JobStatus, progress: r.progress as number, attempts: r.attempts as number,
    maxAttempts: r.maxAttempts as number, nextAttemptAt: (r.nextAttemptAt as number) ?? null,
    error: (r.error as string) ?? null, outputPath: (r.outputPath as string) ?? null,
    outputBytes: (r.outputBytes as number) ?? null, createdAt: r.createdAt as number,
    updatedAt: r.updatedAt as number,
  });

  // -- Errores -----------------------------------------------------------------

  logError(id: string, jobId: string, message: string, attempt: number): void {
    this.run(
      `INSERT INTO errors (id,jobId,message,attempt,createdAt)
       VALUES (:id,:jobId,:message,:attempt,:createdAt)`,
      { id, jobId, message, attempt, createdAt: Date.now() },
    );
  }

  // -- Historial ---------------------------------------------------------------

  addHistory(h: HistoryEntry): void {
    this.run(
      `INSERT INTO history (id,date,title,artist,album,format,bytes,provider,result,outputPath)
       VALUES (:id,:date,:title,:artist,:album,:format,:bytes,:provider,:result,:outputPath)`,
      {
        id: h.id, date: h.date, title: h.title, artist: h.artist, album: h.album,
        format: h.format, bytes: h.bytes, provider: h.provider, result: h.result,
        outputPath: h.outputPath,
      },
    );
  }

  getHistory(limit = 500): HistoryEntry[] {
    return this.all<Record<string, unknown>>(
      'SELECT * FROM history ORDER BY date DESC LIMIT :lim', { lim: limit },
    ).map((r) => ({
      id: r.id as string, date: r.date as number, title: r.title as string,
      artist: r.artist as string, album: r.album as string, format: r.format as string,
      bytes: r.bytes as number, provider: r.provider as HistoryEntry['provider'],
      result: r.result as HistoryEntry['result'], outputPath: (r.outputPath as string) ?? null,
    }));
  }

  deleteHistory(id: string): void {
    this.run('DELETE FROM history WHERE id=:id', { id });
  }

  clearHistory(): void {
    this.run('DELETE FROM history');
  }

  // -- Settings ----------------------------------------------------------------

  getSetting(key: string): string | null {
    const r = this.all<{ value: string }>('SELECT value FROM settings WHERE key=:k', { k: key });
    return r[0]?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.run(
      `INSERT INTO settings (key,value) VALUES (:k,:v)
       ON CONFLICT(key) DO UPDATE SET value=:v`, { k: key, v: value },
    );
  }
}
