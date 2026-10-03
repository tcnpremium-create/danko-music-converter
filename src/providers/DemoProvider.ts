// ============================================================================
// Proveedor de demostración.
//
// Genera contenido de audio SINTÉTICO localmente (un tono con ffmpeg), de modo
// que la conversión, el progreso, los reintentos y los fallos puedan mostrarse
// al cliente sin depender de ninguna fuente externa ni de contenido protegido.
//
// Simula: latencia, velocidad configurable, probabilidad de error y un fallo
// forzado en un índice concreto (para la prueba especial de la canción 47).
// ============================================================================
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Track, Playlist, ProviderId, DemoSettings, AudioMetadata } from '../types/index.js';
import type { SourceProvider, PreparedInput, PrepareContext, ImportResult } from './types.js';
import { resolveFfmpegPath } from '../converter/ffmpeg.js';
import { uuid, duplicateHash } from '../utils/id.js';
import { sleep } from '../utils/retry.js';

const DEMO_ARTISTS = ['Danko', 'Luna Roja', 'The Analogs', 'Neón', 'Aurora', 'Vela', 'Mar Abierto'];
const DEMO_ALBUMS = ['90s Dance', 'Sesiones', 'Directo', 'Rarezas', 'Grandes Éxitos'];
const DEMO_GENRES = ['Dance', 'Electrónica', 'Pop', 'House', 'Synthwave'];

/** Construye una playlist de demostración con N pistas ficticias. */
export function buildDemoPlaylist(trackCount: number): ImportResult {
  const playlistId = uuid();
  const now = Date.now();
  const tracks: Track[] = [];
  let totalDuration = 0;
  let totalBytes = 0;

  for (let i = 0; i < trackCount; i++) {
    const artist = DEMO_ARTISTS[i % DEMO_ARTISTS.length];
    const album = DEMO_ALBUMS[i % DEMO_ALBUMS.length];
    const durationSec = 120 + (i % 7) * 30; // 2:00 – 5:00
    // Tamaño estimado variable (simula diferentes tamaños de archivo).
    const estimatedBytes = Math.round((durationSec * 320 * 1000) / 8) + (i % 5) * 250_000;
    const meta: AudioMetadata = {
      title: `Pista Demo ${String(i + 1).padStart(3, '0')}`,
      artist,
      album,
      albumArtist: artist,
      genre: DEMO_GENRES[i % DEMO_GENRES.length],
      year: 1990 + (i % 10),
      trackNumber: (i % 12) + 1,
      discNumber: 1,
    };
    tracks.push({
      id: uuid(),
      playlistId,
      position: i + 1,
      metadata: meta,
      durationSec,
      sourceFormat: 'wav',
      provider: 'demo',
      estimatedBytes,
    });
    totalDuration += durationSec;
    totalBytes += estimatedBytes;
  }

  const playlist: Playlist = {
    id: playlistId,
    name: `DEMO PLAYLIST (${trackCount})`,
    provider: 'demo',
    trackCount,
    totalDurationSec: totalDuration,
    estimatedBytes: totalBytes,
    createdAt: now,
  };

  return { playlist, tracks };
}

/** Metadatos de duplicado para una pista (usado al persistir). */
export function trackDupHash(t: Track): string {
  return duplicateHash(t.metadata.artist, t.metadata.title, t.durationSec);
}

export class DemoProvider implements SourceProvider {
  readonly id: ProviderId = 'demo';
  readonly label = 'Proveedor de demostración';

  constructor(private settings: () => DemoSettings) {}

  /** Genera un tono corto real con ffmpeg para poder convertirlo de verdad. */
  private generateTone(outPath: string, seconds: number, freq: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const bin = resolveFfmpegPath();
      // Duración corta real (máx 3 s) para que la demo sea ágil aunque la
      // pista "dure" más; el progreso se simula por separado.
      const realDur = Math.min(3, Math.max(1, Math.round(seconds / 60)));
      const args = [
        '-y', '-f', 'lavfi', '-i',
        `sine=frequency=${freq}:duration=${realDur}`,
        '-c:a', 'pcm_s16le', outPath,
      ];
      const child = spawn(bin, args, { stdio: 'ignore' });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg tono código ${code}`))));
    });
  }

  async prepareInput(track: Track, ctx: PrepareContext): Promise<PreparedInput> {
    const cfg = this.settings();
    const idx = track.position - 1;

    // Simular análisis/descarga con progreso, respetando la velocidad configurada.
    const totalBytes = track.estimatedBytes;
    const perTick = Math.max(1, cfg.speedBytesPerSec / 10); // 10 ticks/seg
    let transferred = 0;
    const startedAt = Date.now();

    while (transferred < totalBytes) {
      if (ctx.signal?.cancelled) throw new Error('Cancelado');
      await sleep(100);
      transferred += perTick;
      const pct = Math.min(95, Math.round((transferred / totalBytes) * 100));
      ctx.onProgress?.(pct);
      // Límite de seguridad: no más de 6 s simulando por pista.
      if (Date.now() - startedAt > 6000) break;
    }

    // Fallo forzado en un índice concreto (prueba especial de la canción 47).
    if (cfg.forcedFailureIndex != null && idx === cfg.forcedFailureIndex) {
      throw new Error(`Fallo simulado (forzado) en la pista #${track.position}`);
    }
    // Fallo aleatorio según probabilidad configurada.
    if (Math.random() < cfg.errorProbability) {
      throw new Error(`Fallo simulado (aleatorio) en la pista #${track.position}`);
    }

    mkdirSync(ctx.workDir, { recursive: true });
    const tonePath = join(ctx.workDir, `${track.id}.wav`);
    if (!existsSync(tonePath)) {
      const freq = 220 + (idx % 12) * 40;
      await this.generateTone(tonePath, track.durationSec, freq);
    }
    ctx.onProgress?.(100);

    return {
      inputPath: tonePath,
      durationSec: track.durationSec,
      cleanup: () => {
        try {
          // El material temporal se limpia por el motor tras la conversión.
        } catch {
          /* noop */
        }
      },
    };
  }
}
