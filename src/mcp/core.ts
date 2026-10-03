// ============================================================================
// DankoCore — the ONLY surface the MCP server may touch. It wraps the real
// AppService (library + FFmpeg queue + metadata), with NO shell, NO arbitrary
// filesystem, NO network. Results are honest: nothing is invented.
// ============================================================================
import { existsSync, statSync } from 'node:fs';
import { parseFile } from 'music-metadata';
import { AppService } from '../services/AppService.js';
import { Database, initSqlRuntime } from '../database/Database.js';
import type { OutputFormat, SampleRate, Mp3Bitrate, TrackMetadataPatch } from '../types/index.js';

export interface CoreResult {
  ok: boolean;
  reason?: string;
  message?: string;
  data?: unknown;
  warnings?: string[];
}

export interface Preset {
  id: string; name: string; format: OutputFormat; bitrate?: Mp3Bitrate; sampleRate?: SampleRate;
}

/** Real, DJ-oriented presets. */
export const PRESETS: Preset[] = [
  { id: 'mp3-320', name: 'MP3 320', format: 'mp3', bitrate: 320 },
  { id: 'high-quality', name: 'High Quality (MP3 320)', format: 'mp3', bitrate: 320 },
  { id: 'wav', name: 'WAV', format: 'wav' },
  { id: 'dj-wav', name: 'DJ WAV (44.1 kHz)', format: 'wav', sampleRate: 44100 },
  { id: 'flac', name: 'FLAC Archive', format: 'flac' },
  { id: 'streaming', name: 'Streaming (AAC 256)', format: 'aac', bitrate: 256 },
];

export interface DankoCore {
  searchLibrary(a: Record<string, unknown>): Promise<CoreResult>;
  getTrackMetadata(a: Record<string, unknown>): Promise<CoreResult>;
  analyzeAudio(a: Record<string, unknown>): Promise<CoreResult>;
  convertAudio(a: Record<string, unknown>): Promise<CoreResult>;
  getConversionHistory(a: Record<string, unknown>): Promise<CoreResult>;
  listPresets(): Promise<CoreResult>;
  generateReport(): Promise<CoreResult>;
  updateMetadata(a: Record<string, unknown>): Promise<CoreResult>;
  deleteTracks(a: Record<string, unknown>): Promise<CoreResult>;
  close(): void;
}

export interface CoreOptions {
  dbPath: string;
  workDir: string;
  outputDir: string;
}

/** Real adapter backed by AppService. Reused by stdio and HTTP transports. */
export class AppServiceCore implements DankoCore {
  private constructor(private svc: AppService, private db: Database) {}

  static async open(opts: CoreOptions): Promise<AppServiceCore> {
    await initSqlRuntime();
    const db = await Database.open(opts.dbPath);
    const svc = new AppService(db, {
      dbPath: opts.dbPath, workDir: opts.workDir, defaultOutputDir: opts.outputDir,
    });
    return new AppServiceCore(svc, db);
  }

  /** Expose the underlying service (e.g. to seed demo data in tests). */
  get service(): AppService { return this.svc; }

  close(): void { this.svc.close(); }

  async searchLibrary(a: Record<string, unknown>): Promise<CoreResult> {
    const q = String(a.query ?? '').toLowerCase().trim();
    const artist = String(a.artist ?? '').toLowerCase();
    const title = String(a.title ?? '').toLowerCase();
    const genre = String(a.genre ?? '').toLowerCase();
    const folder = String(a.folder ?? '').toLowerCase();
    const format = a.format ? String(a.format).toLowerCase() : '';
    const year = a.year != null ? Number(a.year) : null;
    const minD = a.minDurationSec != null ? Number(a.minDurationSec) : null;
    const maxD = a.maxDurationSec != null ? Number(a.maxDurationSec) : null;
    const limit = Math.min(500, Math.max(1, Number(a.limit ?? 50)));
    const bpmMin = a.bpmMin != null ? Number(a.bpmMin) : null;
    const bpmMax = a.bpmMax != null ? Number(a.bpmMax) : null;
    const warnings: string[] = [];
    if ((bpmMin != null || bpmMax != null)) {
      warnings.push('BPM filtering matches only tracks already analyzed (run analyze_audio to populate BPM).');
    }

    let rows = this.db.getAllTracks().filter((t) => {
      const m = t.metadata;
      if (q && !(`${m.title} ${m.artist} ${m.album}`.toLowerCase().includes(q))) return false;
      if (artist && !m.artist.toLowerCase().includes(artist)) return false;
      if (title && !m.title.toLowerCase().includes(title)) return false;
      if (genre && !(m.genre ?? '').toLowerCase().includes(genre)) return false;
      if (year != null && m.year !== year) return false;
      if (format && t.sourceFormat.toLowerCase() !== format) return false;
      if (folder && !(t.sourcePath ?? '').toLowerCase().includes(folder)) return false;
      if (minD != null && t.durationSec < minD) return false;
      if (maxD != null && t.durationSec > maxD) return false;
      // BPM filter: only tracks with a known (analyzed) BPM can match.
      if (bpmMin != null && (m.bpm == null || m.bpm < bpmMin)) return false;
      if (bpmMax != null && (m.bpm == null || m.bpm > bpmMax)) return false;
      return true;
    });
    const total = rows.length;
    rows = rows.slice(0, limit);

    return {
      ok: true,
      warnings: warnings.length ? warnings : undefined,
      data: {
        total,
        returned: rows.length,
        tracks: rows.map((t) => ({
          id: t.id, title: t.metadata.title, artist: t.metadata.artist, album: t.metadata.album,
          genre: t.metadata.genre ?? null, year: t.metadata.year ?? null,
          format: t.sourceFormat, durationSec: t.durationSec,
          hasLocalFile: !!t.sourcePath && existsSync(t.sourcePath),
          bpm: t.metadata.bpm ?? null, key: t.metadata.key ?? null, camelot: t.metadata.camelot ?? null,
        })),
      },
    };
  }

  async getTrackMetadata(a: Record<string, unknown>): Promise<CoreResult> {
    const t = this.db.getTrackById(String(a.trackId ?? ''));
    if (!t) return { ok: false, reason: 'not-found', message: 'Track not found.' };
    const m = t.metadata;
    return {
      ok: true,
      data: {
        id: t.id, title: m.title, artist: m.artist, album: m.album, albumArtist: m.albumArtist ?? null,
        genre: m.genre ?? null, year: m.year ?? null, trackNumber: m.trackNumber ?? null,
        composer: m.composer ?? null, isrc: m.isrc ?? null, comment: m.comment ?? null,
        durationSec: t.durationSec, format: t.sourceFormat, provider: t.provider,
        estimatedBytes: t.estimatedBytes, hasLocalFile: !!t.sourcePath && existsSync(t.sourcePath),
        bpm: m.bpm ?? null, key: m.key ?? null, camelot: m.camelot ?? null,
      },
    };
  }

  async analyzeAudio(a: Record<string, unknown>): Promise<CoreResult> {
    const t = this.db.getTrackById(String(a.trackId ?? ''));
    if (!t) return { ok: false, reason: 'not-found', message: 'Track not found.' };
    if (!t.sourcePath || !existsSync(t.sourcePath)) {
      return { ok: false, reason: 'file-unavailable', message: 'No local file to analyze for this track.' };
    }
    try {
      const parsed = await parseFile(t.sourcePath, { duration: true });
      const f = parsed.format;
      const size = statSync(t.sourcePath).size;
      // Real DSP analysis (cached in the DB). Null only if it genuinely fails.
      const analysis = this.svc.analyzeTrack(String(a.trackId ?? ''), { force: a.force === true });
      return {
        ok: true,
        data: {
          id: t.id,
          durationSec: f.duration ?? t.durationSec,
          container: f.container ?? null,
          codec: f.codec ?? null,
          bitrate: f.bitrate ?? null,
          sampleRate: f.sampleRate ?? null,
          channels: f.numberOfChannels ?? null,
          lossless: f.lossless ?? null,
          sizeBytes: size,
          bpm: analysis?.bpm ?? null,
          key: analysis?.key ?? null,
          camelot: analysis?.camelot ?? null,
          loudnessDb: analysis?.loudnessDb ?? null,
          analysisCached: analysis?.cached ?? false,
        },
      };
    } catch (e) {
      return { ok: false, reason: 'analyze-failed', message: String((e as Error)?.message ?? e) };
    }
  }

  async listPresets(): Promise<CoreResult> {
    return { ok: true, data: PRESETS };
  }

  async convertAudio(a: Record<string, unknown>): Promise<CoreResult> {
    const trackIds = Array.isArray(a.trackIds) ? a.trackIds.map(String) : [];
    if (trackIds.length === 0) return { ok: false, reason: 'bad-input', message: 'trackIds required.' };

    let format = a.format as OutputFormat | undefined;
    let bitrate: Mp3Bitrate | undefined;
    let sampleRate: SampleRate | undefined;
    if (a.preset) {
      const p = PRESETS.find((x) => x.id === a.preset);
      if (!p) return { ok: false, reason: 'bad-input', message: `Unknown preset: ${String(a.preset)}` };
      format = p.format; bitrate = p.bitrate; sampleRate = p.sampleRate;
    }
    if (!format) format = 'mp3';

    const current = this.svc.getSettings().conversion;
    this.svc.updateSettings({
      conversion: {
        ...current,
        outputFormat: format,
        mp3Bitrate: bitrate ?? current.mp3Bitrate,
        sampleRate: sampleRate ?? current.sampleRate,
      },
    });

    const queued: string[] = [];
    const missing: string[] = [];
    for (const id of trackIds) {
      const t = this.db.getTrackById(id);
      if (!t) { missing.push(id); continue; }
      // Local tracks need their file present; providers that synthesize input
      // (e.g. demo) do not. Never block a convertible track, never pretend a
      // missing local file is convertible.
      if (t.provider === 'local' && (!t.sourcePath || !existsSync(t.sourcePath))) { missing.push(id); continue; }
      const job = this.svc.enqueueTrack(id);
      if (job) queued.push(job.id);
    }
    if (queued.length === 0) {
      return { ok: false, reason: 'nothing-to-convert', message: 'No tracks with a local source file to convert.', data: { missing } };
    }

    const wait = a.wait === true;
    if (!wait) {
      this.svc.startQueue();
      return { ok: true, message: `Queued ${queued.length} conversion(s) to ${format}.`, data: { jobIds: queued, missing, format, waited: false } };
    }

    await new Promise<void>((resolve) => {
      const done = () => resolve();
      this.svc.queue.once('drained', done);
      this.svc.startQueue();
    });
    const outputs = this.svc.queue.getJobs()
      .filter((j) => queued.includes(j.id))
      .map((j) => ({ jobId: j.id, status: j.status, outputPath: j.outputPath, outputBytes: j.outputBytes }));
    return { ok: true, message: `Converted ${outputs.filter((o) => o.status === 'COMPLETADO').length}/${queued.length}.`, data: { outputs, missing, format, waited: true } };
  }

  async getConversionHistory(a: Record<string, unknown>): Promise<CoreResult> {
    const limit = Math.min(500, Math.max(1, Number(a.limit ?? 50)));
    return { ok: true, data: this.svc.getHistory().slice(0, limit) };
  }

  async generateReport(): Promise<CoreResult> {
    const dash = this.svc.getDashboard();
    const byFormat: Record<string, number> = {};
    for (const t of this.db.getAllTracks()) {
      byFormat[t.sourceFormat] = (byFormat[t.sourceFormat] ?? 0) + 1;
    }
    return { ok: true, data: { ...dash, tracksByFormat: byFormat } };
  }

  async updateMetadata(a: Record<string, unknown>): Promise<CoreResult> {
    const trackId = String(a.trackId ?? '');
    const patch = (a.patch ?? {}) as TrackMetadataPatch;
    const updated = this.svc.updateTrackMetadata(trackId, patch);
    if (!updated) return { ok: false, reason: 'not-found', message: 'Track not found.' };
    return { ok: true, message: 'Metadata updated.', data: { id: updated.id, metadata: updated.metadata } };
  }

  async deleteTracks(a: Record<string, unknown>): Promise<CoreResult> {
    const trackIds = Array.isArray(a.trackIds) ? a.trackIds.map(String) : [];
    let removed = 0;
    for (const id of trackIds) {
      if (this.db.getTrackById(id)) { this.svc.removeTrack(id); removed++; }
    }
    return {
      ok: true,
      message: `Removed ${removed} library entr${removed === 1 ? 'y' : 'ies'}. Audio files on disk were NOT deleted.`,
      data: { removed, requested: trackIds.length },
    };
  }
}
