// ============================================================================
// Servicio de aplicación (proceso principal): orquesta BD, proveedores, cola y
// conversión. Expone operaciones de alto nivel que la capa IPC invoca.
// ============================================================================
import { existsSync, mkdirSync, statSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import type {
  AppSettings, Job, Playlist, Track, HistoryEntry, OutputFormat,
  InterruptedQueueInfo, DuplicatePolicy, TrackMetadataPatch, LibraryItem, MatchRow, DashboardSummary,
} from '../types/index.js';
import { bestMatch, type MatchFields } from '../matching/matching.js';
import { analyzePcmMono } from '../analysis/analysis.js';
import { decodeToMonoPcm } from '../analysis/decode.js';
import { buildVirtualDjExport } from '../dj/export.js';

export interface AudioAnalysis {
  bpm: number | null;
  key: string | null;
  camelot: string | null;
  loudnessDb?: number | null;
  cached: boolean;
}
import { DEFAULT_SETTINGS } from '../types/index.js';
import { Database } from '../database/Database.js';
import { ProviderRegistry } from '../providers/registry.js';
import { trackDupHash, buildDemoPlaylist } from '../providers/DemoProvider.js';
import { QueueEngine, type JobProcessor, type JobContext } from '../queue/QueueEngine.js';
import { convert } from '../converter/ffmpeg.js';
import { readAudioFile, formatFromPath } from '../metadata/reader.js';
import { applyNamingTemplate, sanitizeSegment } from '../utils/sanitize.js';
import { withTimeout } from '../utils/retry.js';
import { SpotifyClient } from '../spotify/SpotifyClient.js';
import { uuid } from '../utils/id.js';

const FORMAT_EXT: Record<OutputFormat, string> = {
  mp3: '.mp3', flac: '.flac', wav: '.wav', m4a: '.m4a', aac: '.aac', aiff: '.aiff',
};

export interface AppPaths {
  dbPath: string;
  workDir: string; // temporales
  defaultOutputDir: string;
}

export class AppService {
  private settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
  private registry: ProviderRegistry;
  queue: QueueEngine;

  constructor(private db: Database, private paths: AppPaths) {
    this.loadSettings();
    if (!this.settings.conversion.outputDir) {
      this.settings.conversion.outputDir = paths.defaultOutputDir;
    }
    this.registry = new ProviderRegistry(() => this.settings.demo);
    this.queue = new QueueEngine(
      this.settings.queue,
      this.buildProcessor(),
      {
        saveJob: (j) => { this.db.upsertJob(j); this.db.persist(); },
        logError: (jobId, message, attempt) =>
          this.db.logError(uuid(), jobId, message, attempt),
        onComplete: (j) => this.recordHistory(j, 'COMPLETADO'),
        onFinalError: (j) => this.recordHistory(j, 'ERROR'),
      },
    );
  }

  // -- Settings ---------------------------------------------------------------

  private loadSettings(): void {
    const raw = this.db.getSetting('app');
    if (raw) {
      try {
        this.settings = { ...structuredClone(DEFAULT_SETTINGS), ...JSON.parse(raw) };
      } catch {
        this.settings = structuredClone(DEFAULT_SETTINGS);
      }
    }
  }

  getSettings(): AppSettings {
    return structuredClone(this.settings);
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    this.settings = {
      general: { ...this.settings.general, ...patch.general },
      conversion: { ...this.settings.conversion, ...patch.conversion },
      queue: { ...this.settings.queue, ...patch.queue },
      demo: { ...this.settings.demo, ...patch.demo },
      spotify: { ...this.settings.spotify, ...patch.spotify },
    };
    // Clamp de seguridad de la concurrencia (1..5) y reintentos (>=1).
    this.settings.queue.concurrency = Math.min(5, Math.max(1, this.settings.queue.concurrency));
    this.settings.queue.maxAttempts = Math.max(1, this.settings.queue.maxAttempts);
    this.db.setSetting('app', JSON.stringify(this.settings));
    this.db.persist();
    this.queue.updateSettings(this.settings.queue);
    return this.getSettings();
  }

  /** Cierre ordenado: pausa la cola y cierra la base de datos. */
  close(): void {
    try { this.queue.pause(); } catch { /* noop */ }
    this.db.close();
  }

  // -- Importación ------------------------------------------------------------

  importDemoPlaylist(trackCount?: number): { playlist: Playlist; tracks: Track[] } {
    const n = trackCount ?? this.settings.demo.trackCount;
    const { playlist, tracks } = buildDemoPlaylist(n);
    this.persistImport(playlist, tracks);
    return { playlist, tracks };
  }

  /** Importa archivos locales seleccionados por el usuario. */
  async importLocalFiles(files: string[], playlistName = 'Importación local'): Promise<{ playlist: Playlist; tracks: Track[] }> {
    const artworkDir = join(this.paths.workDir, 'artwork');
    const playlistId = uuid();
    const tracks: Track[] = [];
    let totalDuration = 0;
    let totalBytes = 0;
    let pos = 1;

    for (const file of files) {
      if (!existsSync(file) || !formatFromPath(file)) continue;
      try {
        const { metadata, durationSec, format } = await readAudioFile(file, artworkDir);
        const size = statSync(file).size;
        tracks.push({
          id: uuid(), playlistId, position: pos++, metadata, durationSec,
          sourceFormat: format, sourcePath: file, provider: 'local', estimatedBytes: size,
        });
        totalDuration += durationSec;
        totalBytes += size;
      } catch {
        // Archivo ilegible: se omite del import.
      }
    }

    const playlist: Playlist = {
      id: playlistId, name: playlistName, provider: 'local',
      trackCount: tracks.length, totalDurationSec: totalDuration,
      estimatedBytes: totalBytes, createdAt: Date.now(),
    };
    this.persistImport(playlist, tracks);
    return { playlist, tracks };
  }

  /** Importa una playlist Spotify como metadatos y empareja el audio con archivos locales. */
  async importSpotifyPlaylist(url: string, localFolder?: string): Promise<{ playlist: Playlist; tracks: Track[]; matched: number }> {
    const clientId = this.settings.spotify.clientId || process.env.DANKO_SPOTIFY_CLIENT_ID || '';
    const client = new SpotifyClient(clientId, join(dirname(this.paths.dbPath), 'spotify-refresh-token.bin'));
    const { playlist: remote, tracks: remoteTracks } = await client.getPlaylist(url);

    const localFiles: string[] = [];
    if (localFolder && existsSync(localFolder)) {
      const walk = (d: string): void => {
        for (const entry of readdirSync(d, { withFileTypes: true })) {
          const full = join(d, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (formatFromPath(full)) localFiles.push(full);
        }
      };
      walk(localFolder);
    }

    const index = new Map<string, { path: string; format: any; bytes: number }>();
    for (const file of localFiles) {
      try {
        const parsed = await readAudioFile(file, join(this.paths.workDir, 'spotify-match-artwork'));
        const key = normalizeMatch(parsed.metadata.artist, parsed.metadata.title);
        if (!index.has(key)) index.set(key, { path: file, format: parsed.format, bytes: statSync(file).size });
      } catch { /* archivo no legible */ }
    }

    const playlistId = uuid();
    const imported: Track[] = [];
    let totalDuration = 0;
    let estimatedBytes = 0;
    let matched = 0;

    for (let i = 0; i < remoteTracks.length; i++) {
      const rt = remoteTracks[i];
      const artist = rt.artists.map(a => a.name).join(', ');
      const albumArtist = rt.album.artists?.map(a => a.name).join(', ') || artist;
      const local = index.get(normalizeMatch(artist, rt.name));
      const durationSec = rt.duration_ms / 1000;
      const t: Track = {
        id: uuid(), playlistId, position: i + 1,
        metadata: {
          title: rt.name, artist, album: rt.album.name, albumArtist,
          trackNumber: rt.track_number, discNumber: rt.disc_number,
          artworkPath: rt.album.images?.[0]?.url,
          comment: rt.external_urls?.spotify ? 'Spotify: ' + rt.external_urls.spotify : undefined,
        },
        durationSec, sourceFormat: local?.format ?? 'mp3', sourcePath: local?.path,
        provider: 'spotify', estimatedBytes: local?.bytes ?? 0,
      };
      imported.push(t);
      totalDuration += durationSec;
      if (local) { matched++; estimatedBytes += local.bytes; }
    }

    const p: Playlist = {
      id: playlistId, name: remote.name, provider: 'spotify',
      artworkPath: remote.images?.[0]?.url, trackCount: imported.length,
      totalDurationSec: totalDuration, estimatedBytes, createdAt: Date.now(),
    };
    this.persistImport(p, imported);
    return { playlist: p, tracks: imported, matched };
  }
  /** Importa recursivamente una carpeta de audio local. */
  async importFolder(dir: string): Promise<{ playlist: Playlist; tracks: Track[] }> {
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (formatFromPath(full)) files.push(full);
      }
    };
    if (existsSync(dir)) walk(dir);
    return this.importLocalFiles(files, `Carpeta: ${dir.split(/[\\/]/).pop()}`);
  }

  private persistImport(playlist: Playlist, tracks: Track[]): void {
    this.db.upsertPlaylist(playlist);
    for (const t of tracks) this.db.insertTrack(t, trackDupHash(t));
    this.db.persist();
  }

  getPlaylists(): Playlist[] {
    return this.db.getPlaylists();
  }

  getTracks(playlistId: string): Track[] {
    return this.db.getTracks(playlistId);
  }

  getHistory(): HistoryEntry[] {
    return this.db.getHistory();
  }

  deleteHistory(id: string): void {
    this.db.deleteHistory(id);
    this.db.persist();
  }

  /** Edición de metadatos de una pista antes de convertir. */
  updateTrackMetadata(trackId: string, patch: TrackMetadataPatch): Track | null {
    const t = this.db.getTrack(trackId);
    if (!t) return null;
    const updated: Track = {
      ...t,
      metadata: {
        ...t.metadata,
        ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
      },
    };
    this.db.insertTrack(updated, trackDupHash(updated));
    this.db.persist();
    return updated;
  }

  removeTrack(trackId: string): void {
    const t = this.db.getTrack(trackId);
    this.db.deleteTrack(trackId);
    if (t) this.recomputePlaylist(t.playlistId);
    this.db.persist();
  }

  // -- Playlist CRUD ----------------------------------------------------------

  /** Crea una playlist vacía (para añadirle pistas manualmente después). */
  createPlaylist(name: string): Playlist {
    const playlist: Playlist = {
      id: uuid(), name: name.trim() || 'Nueva playlist', provider: 'local',
      trackCount: 0, totalDurationSec: 0, estimatedBytes: 0, createdAt: Date.now(),
    };
    this.db.upsertPlaylist(playlist);
    this.db.persist();
    return playlist;
  }

  renamePlaylist(id: string, name: string): Playlist | null {
    const p = this.db.getPlaylist(id);
    if (!p) return null;
    const updated = { ...p, name: name.trim() || p.name };
    this.db.upsertPlaylist(updated);
    this.db.persist();
    return updated;
  }

  deletePlaylist(id: string): void {
    this.db.deletePlaylist(id);
    this.db.persist();
  }

  /** Duplica una playlist con todas sus pistas (nuevos ids). */
  duplicatePlaylist(id: string): Playlist | null {
    const src = this.db.getPlaylist(id);
    if (!src) return null;
    const newId = uuid();
    const copy: Playlist = { ...src, id: newId, name: `${src.name} (copia)`, createdAt: Date.now() };
    this.db.upsertPlaylist(copy);
    for (const t of this.db.getTracks(id)) {
      const nt: Track = { ...t, id: uuid(), playlistId: newId };
      this.db.insertTrack(nt, trackDupHash(nt));
    }
    this.db.persist();
    return copy;
  }

  /** Reordena una pista dentro de su playlist intercambiando posiciones. */
  reorderTrack(trackId: string, dir: -1 | 1): void {
    const t = this.db.getTrack(trackId);
    if (!t) return;
    const list = this.db.getTracks(t.playlistId); // ordenadas por position
    const idx = list.findIndex((x) => x.id === trackId);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return;
    const a = list[idx];
    const b = list[swapIdx];
    const pa = a.position;
    const pb = b.position;
    this.db.insertTrack({ ...a, position: pb }, trackDupHash(a));
    this.db.insertTrack({ ...b, position: pa }, trackDupHash(b));
    this.db.persist();
  }

  /** Exporta una playlist como texto M3U (rutas locales de origen). */
  exportPlaylistM3U(id: string): string {
    const p = this.db.getPlaylist(id);
    const tracks = this.db.getTracks(id);
    const lines = ['#EXTM3U', `#PLAYLIST:${p?.name ?? 'DANKO'}`];
    for (const t of tracks) {
      lines.push(`#EXTINF:${Math.round(t.durationSec)},${t.metadata.artist} - ${t.metadata.title}`);
      lines.push(t.sourcePath ?? `# (sin archivo local) ${t.metadata.artist} - ${t.metadata.title}`);
    }
    return lines.join('\n') + '\n';
  }

  prepareVirtualDjExport(id: string) {
    if (!this.db.getPlaylist(id)) throw new Error('La playlist ya no existe');
    const result = buildVirtualDjExport(this.db.getTracks(id), this.db.getJobs(id));
    if (!result.exported) throw new Error('No hay archivos locales válidos para exportar. Importa música local o completa las conversiones primero.');
    return result;
  }

  clearHistory(): void {
    this.db.clearHistory();
    this.db.persist();
  }

  /** Recalcula los agregados de una playlist a partir de sus pistas. */
  private recomputePlaylist(playlistId: string): void {
    const p = this.db.getPlaylist(playlistId);
    if (!p) return;
    const tracks = this.db.getTracks(playlistId);
    this.db.upsertPlaylist({
      ...p,
      trackCount: tracks.length,
      totalDurationSec: tracks.reduce((s, t) => s + t.durationSec, 0),
      estimatedBytes: tracks.reduce((s, t) => s + t.estimatedBytes, 0),
    });
  }

  // -- Biblioteca -------------------------------------------------------------

  /** Archivos ya convertidos que existen en disco (a partir del historial). */
  /** Resumen del dashboard con datos reales de SQLite + estado de cola en vivo. */
  getDashboard(): DashboardSummary {
    const h = this.db.historyStats();
    const stats = this.queue.stats();
    return {
      tracks: this.db.countTracks(),
      playlists: this.db.getPlaylists().length,
      conversionsTotal: h.total,
      conversionsCompleted: h.completed,
      conversionsErrors: h.errors,
      bytesUsed: h.bytes,
      queuePending: stats.pending,
      queueProcessing: stats.processing,
      queueErrors: stats.errors,
      recent: this.db.getHistory(8),
    };
  }

  getLibrary(): LibraryItem[] {
    const seen = new Set<string>();
    const items: LibraryItem[] = [];
    for (const h of this.db.getHistory(2000)) {
      if (h.result !== 'COMPLETADO' || !h.outputPath) continue;
      if (seen.has(h.outputPath)) continue;
      seen.add(h.outputPath);
      const exists = existsSync(h.outputPath);
      items.push({
        id: h.id, title: h.title, artist: h.artist, album: h.album,
        genre: null, year: null, format: h.format, bytes: h.bytes, date: h.date,
        path: h.outputPath, exists,
      });
    }
    return items;
  }

  /** Devuelve una ruta local reproducible, validada, o null si no existe. */
  getPlayablePath(path: string): string | null {
    return path && existsSync(path) ? path : null;
  }

  // -- Análisis musical (BPM / tonalidad / Camelot) ---------------------------

  /**
   * Analiza una pista real (decodifica con FFmpeg y ejecuta DSP) y cachea el
   * resultado en la BD. Si ya está cacheado y no se fuerza, lo reutiliza.
   * Nunca inventa valores: si no hay archivo local, devuelve null.
   */
  analyzeTrack(trackId: string, opts: { force?: boolean } = {}): AudioAnalysis | null {
    const t = this.db.getTrack(trackId);
    if (!t) return null;
    if (!opts.force && t.metadata.bpm != null) {
      return { bpm: t.metadata.bpm, key: t.metadata.key ?? null, camelot: t.metadata.camelot ?? null, cached: true };
    }
    if (!t.sourcePath || !existsSync(t.sourcePath)) return null;
    const decoded = decodeToMonoPcm(t.sourcePath);
    if (!decoded) return null;
    const r = analyzePcmMono(decoded.pcm, decoded.sampleRate);
    this.db.setTrackAnalysis(trackId, { bpm: r.bpm, key: r.key, camelot: r.camelot });
    this.db.persist();
    return { bpm: r.bpm, key: r.key, camelot: r.camelot, loudnessDb: r.loudnessDb, cached: false };
  }

  /** Analiza en lote; devuelve cuántas se analizaron realmente (no cacheadas). */
  batchAnalyzeTracks(trackIds: string[], opts: { force?: boolean } = {}): { analyzed: number; skipped: number } {
    let analyzed = 0; let skipped = 0;
    for (const id of trackIds) {
      const before = this.db.getTrack(id)?.metadata.bpm;
      const res = this.analyzeTrack(id, opts);
      if (res && (opts.force || before == null)) analyzed++; else skipped++;
    }
    return { analyzed, skipped };
  }

  // -- Cola -------------------------------------------------------------------

  private makeJobs(playlistId: string, tracks: Track[]): Job[] {
    const now = Date.now();
    return tracks.map((t) => ({
      id: uuid(), playlistId, trackId: t.id, status: 'PENDIENTE' as const,
      progress: 0, attempts: 0, maxAttempts: this.settings.queue.maxAttempts,
      nextAttemptAt: null, error: null, outputPath: null, outputBytes: null,
      createdAt: now, updatedAt: now,
    }));
  }

  enqueuePlaylist(playlistId: string): Job[] {
    const jobs = this.makeJobs(playlistId, this.db.getTracks(playlistId));
    for (const j of jobs) this.db.upsertJob(j);
    this.db.persist();
    this.queue.load(jobs);
    return jobs;
  }

  /**
   * Encola una ÚNICA pista (acción individual "Procesar canción"). Solo crea el
   * job de esa pista: nunca toca las demás canciones de la playlist.
   * Idempotente: si esa pista ya tiene un job activo (no terminal) en la cola,
   * lo reutiliza en lugar de crear un duplicado que la procesaría dos veces.
   */
  enqueueTrack(trackId: string): Job | null {
    const track = this.db.getTrack(trackId);
    if (!track) return null;

    const ACTIVE: Job['status'][] = ['PENDIENTE', 'ANALIZANDO', 'PROCESANDO', 'REINTENTANDO'];
    const existing = this.queue.getJobs().find(
      (j) => j.trackId === trackId && ACTIVE.includes(j.status),
    );
    if (existing) return existing;

    const [job] = this.makeJobs(track.playlistId, [track]);
    this.db.upsertJob(job);
    this.db.persist();
    this.queue.load([job]);
    return job;
  }

  startQueue(): void { this.queue.start(); }
  pauseQueue(): void { this.queue.pause(); }
  retryJob(id: string): void { this.queue.retryJob(id); }
  cancelJob(id: string): void { this.queue.cancelJob(id); }
  cancelAll(): void { this.queue.cancelAll(); this.db.persist(); }
  retryFailed(): number { const n = this.queue.retryFailed(); this.db.persist(); return n; }
  clearCompleted(): number { return this.queue.clearCompleted(); }
  clearFailed(): number { return this.queue.clearFailed(); }
  removeJob(id: string): void { this.queue.removeJob(id); this.db.deleteJob(id); this.db.persist(); }
  reorderJob(id: string, dir: -1 | 1): void { this.queue.reorderJob(id, dir); this.db.persist(); }

  // -- Matching Spotify → biblioteca local ------------------------------------

  /**
   * Puntúa cada pista de una playlist contra la biblioteca local y devuelve, por
   * pista, el mejor candidato con veredicto MATCH/PROBABLE/REVISAR/SIN_MATCH.
   * No asocia nada automáticamente: es material para la UI de revisión.
   */
  matchPlaylistToLibrary(playlistId: string): MatchRow[] {
    const refs = this.db.getTracks(playlistId);
    // Candidatos: todas las pistas locales (de proveedores con archivo en disco).
    const candidates = this.db.getAllLocalTracks().map((t) => ({
      trackId: t.id,
      path: t.sourcePath ?? '',
      fields: {
        artist: t.metadata.artist, title: t.metadata.title, album: t.metadata.album,
        durationSec: t.durationSec, trackNumber: t.metadata.trackNumber, isrc: t.metadata.isrc,
      } as MatchFields,
    })).filter((c) => c.path);

    return refs.map((ref) => {
      const refFields: MatchFields = {
        artist: ref.metadata.artist, title: ref.metadata.title, album: ref.metadata.album,
        durationSec: ref.durationSec, trackNumber: ref.metadata.trackNumber, isrc: ref.metadata.isrc,
      };
      const best = bestMatch(refFields, candidates.map((c) => c.fields));
      const cand = best ? candidates[best.index] : null;
      return {
        trackId: ref.id,
        title: ref.metadata.title,
        artist: ref.metadata.artist,
        score: best?.result.score ?? 0,
        verdict: best?.result.verdict ?? 'SIN_MATCH',
        reasons: best?.result.reasons ?? [],
        candidateTrackId: cand?.trackId ?? null,
        candidatePath: cand?.path ?? null,
      };
    });
  }

  /** Acepta manualmente una coincidencia: asocia el archivo local a la pista. */
  acceptMatch(trackId: string, candidatePath: string): Track | null {
    const t = this.db.getTrack(trackId);
    if (!t || !existsSync(candidatePath)) return null;
    const updated: Track = { ...t, sourcePath: candidatePath, provider: t.provider };
    this.db.insertTrack(updated, trackDupHash(updated));
    this.db.persist();
    return updated;
  }

  // -- Recuperación -----------------------------------------------------------

  getInterruptedQueue(): InterruptedQueueInfo | null {
    const unfinished = this.db.getUnfinishedJobs();
    if (unfinished.length === 0) return null;
    const playlistId = unfinished[0].playlistId;
    const all = this.db.getJobs(playlistId);
    const playlist = this.db.getPlaylist(playlistId);
    return {
      playlistName: playlist?.name ?? 'Cola interrumpida',
      total: all.length,
      completed: all.filter((j) => j.status === 'COMPLETADO').length,
      processing: all.filter((j) => j.status === 'PROCESANDO' || j.status === 'ANALIZANDO').length,
      pending: all.filter((j) => j.status === 'PENDIENTE' || j.status === 'REINTENTANDO').length,
    };
  }

  resumeInterruptedQueue(): Job[] {
    const unfinished = this.db.getUnfinishedJobs();
    if (unfinished.length === 0) return [];
    const playlistId = unfinished[0].playlistId;
    const jobs = this.db.getJobs(playlistId);
    this.queue.load(jobs);
    return jobs;
  }

  discardInterruptedQueue(): void {
    const unfinished = this.db.getUnfinishedJobs();
    if (unfinished.length === 0) return;
    this.db.deleteJobs(unfinished[0].playlistId);
    this.db.persist();
  }

  // -- Procesador de jobs -----------------------------------------------------

  private buildProcessor(): JobProcessor {
    return async (job: Job, ctx: JobContext) => {
      const track = this.db.getTrack(job.trackId);
      if (!track) throw new Error(`Pista no encontrada: ${job.trackId}`);

      const provider = this.registry.get(track.provider);
      const workDir = join(this.paths.workDir, 'jobs', job.id);
      mkdirSync(workDir, { recursive: true });

      // Fase 1: preparar entrada (0..50% del progreso).
      const prepared = await provider.prepareInput(track, {
        workDir,
        signal: ctx.signal,
        onProgress: (p) => ctx.onProgress(Math.round(p * 0.5)),
      });

      if (ctx.signal.cancelled) throw new Error('Cancelado');

      // Resolver ruta de salida aplicando plantilla + política de duplicados.
      const { outputPath, skip } = this.resolveOutputPath(track);
      if (skip) {
        // Duplicado con política OMITIR: se marca como completado sin reconvertir.
        cleanupDir(workDir);
        prepared.cleanup?.();
        const size = existsSync(outputPath) ? statSync(outputPath).size : 0;
        return { outputPath, outputBytes: size };
      }

      // Fase 2: convertir (50..100%).
      const handle = convert({
        input: prepared.inputPath,
        output: outputPath,
        format: this.settings.conversion.outputFormat,
        mp3Bitrate: this.settings.conversion.mp3Bitrate,
        sampleRate: this.settings.conversion.sampleRate,
        metadata: this.settings.conversion.writeMetadata ? track.metadata : undefined,
        embedArtwork: this.settings.conversion.embedArtwork,
        writeMetadata: this.settings.conversion.writeMetadata,
        durationSec: prepared.durationSec,
        priority: this.settings.queue.priority,
        onProgress: (p) => ctx.onProgress(50 + Math.round(p * 0.5)),
      });

      // Timeout: si se agota, cancelamos el proceso ffmpeg.
      const timeoutMs = this.settings.queue.timeoutSec * 1000;
      try {
        await withTimeout(handle.promise, timeoutMs, () => handle.cancel());
      } finally {
        cleanupDir(workDir);
        prepared.cleanup?.();
      }

      const outputBytes = statSync(outputPath).size;
      return { outputPath, outputBytes };
    };
  }

  /** Aplica plantilla de nombres y política de duplicados. */
  private resolveOutputPath(track: Track): { outputPath: string; skip: boolean } {
    const ext = FORMAT_EXT[this.settings.conversion.outputFormat];
    const rel = applyNamingTemplate(this.settings.conversion.namingTemplate, {
      artist: track.metadata.artist,
      title: track.metadata.title,
      album: track.metadata.album,
      albumArtist: track.metadata.albumArtist,
      trackNumber: track.metadata.trackNumber,
      discNumber: track.metadata.discNumber,
      year: track.metadata.year,
      genre: track.metadata.genre,
    });
    let outputPath = join(this.settings.conversion.outputDir, rel + ext);

    // Defensa en profundidad: la ruta de salida NUNCA debe escapar de outputDir
    // (aunque la plantilla o los metadatos intenten ../ o rutas absolutas). Si
    // la ruta resuelta no está contenida, se usa un nombre seguro plano dentro
    // de outputDir.
    const baseResolved = resolve(this.settings.conversion.outputDir);
    const resolved = resolve(outputPath);
    if (resolved !== baseResolved && !resolved.startsWith(baseResolved + sep)) {
      outputPath = join(
        this.settings.conversion.outputDir,
        sanitizeSegment(track.metadata.title ?? '', 'pista') + ext,
      );
    }

    const policy: DuplicatePolicy = this.settings.conversion.duplicatePolicy;
    if (existsSync(outputPath)) {
      switch (policy) {
        case 'OMITIR':
          return { outputPath, skip: true };
        case 'SOBRESCRIBIR':
          return { outputPath, skip: false };
        case 'RENOMBRAR':
        case 'CREAR_COPIA':
          outputPath = uniquePath(outputPath, ext);
          return { outputPath, skip: false };
      }
    }
    return { outputPath, skip: false };
  }

  private recordHistory(job: Job, result: 'COMPLETADO' | 'ERROR'): void {
    const track = this.db.getTrack(job.trackId);
    if (!track) return;
    const entry: HistoryEntry = {
      id: uuid(), date: Date.now(),
      title: track.metadata.title, artist: track.metadata.artist, album: track.metadata.album,
      format: this.settings.conversion.outputFormat, bytes: job.outputBytes ?? 0,
      provider: track.provider, result, outputPath: job.outputPath,
    };
    this.db.addHistory(entry);
    this.db.persist();
  }
}

// -- helpers de módulo --------------------------------------------------------

function uniquePath(path: string, ext: string): string {
  const base = path.slice(0, -ext.length);
  let i = 1;
  let candidate = `${base} (${i})${ext}`;
  while (existsSync(candidate)) {
    i++;
    candidate = `${base} (${i})${ext}`;
  }
  return candidate;
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* noop */
  }
}

function normalizeMatch(artist: string, title: string): string {
  const clean = (s: string) => s.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\(\[\{].*?[\)\]\}]/g, '').replace(/\b(feat\.?|ft\.?|remix|radio edit|official video)\b/gi, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return clean(artist) + '::' + clean(title);
}
