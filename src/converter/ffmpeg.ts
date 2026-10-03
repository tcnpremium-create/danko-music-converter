// ============================================================================
// Envoltura de FFmpeg para conversión de audio con seguimiento de progreso.
// Resuelve la ruta del binario según entorno (dev vs empaquetado).
// ============================================================================
import { spawn, type ChildProcess } from 'node:child_process';
import { statSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { setPriority as osSetPriority } from 'node:os';
import type { OutputFormat, Mp3Bitrate, AudioMetadata } from '../types/index.js';

const nodeRequire = createRequire(import.meta.url);

// Registro de procesos FFmpeg vivos, para poder matarlos al cerrar la app y
// evitar procesos huérfanos.
const activeChildren = new Set<ChildProcess>();

/** Mata todos los procesos FFmpeg en curso. Llamado al cerrar la aplicación. */
export function killAllFfmpeg(): void {
  for (const c of activeChildren) {
    try {
      if (!c.killed) c.kill('SIGKILL');
    } catch {
      /* noop */
    }
  }
  activeChildren.clear();
}

/** Número de procesos FFmpeg activos (para pruebas/diagnóstico). */
export function activeFfmpegCount(): number {
  return activeChildren.size;
}

/** Localiza el binario ffmpeg. En producción se empaqueta en resources/ffmpeg. */
export function resolveFfmpegPath(): string {
  // 1) Override explícito (tests, CI, empaquetado).
  if (process.env.DANKO_FFMPEG && existsSync(process.env.DANKO_FFMPEG)) {
    return process.env.DANKO_FFMPEG;
  }
  // 2) Empaquetado junto a la app (electron-builder copia a resources/ffmpeg).
  const resBase = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resBase) {
    const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const packed = `${resBase}/ffmpeg/${exe}`;
    if (existsSync(packed)) return packed;
  }
  // 3) Desarrollo: ffmpeg-static desde node_modules.
  try {
    const ffmpegStatic = nodeRequire('ffmpeg-static') as string | null;
    if (ffmpegStatic && existsSync(ffmpegStatic)) return ffmpegStatic;
  } catch {
    /* ffmpeg-static no disponible: se cae al PATH */
  }
  // 4) Último recurso: confiar en PATH.
  return 'ffmpeg';
}

export interface ConvertOptions {
  input: string;
  output: string;
  format: OutputFormat;
  mp3Bitrate: Mp3Bitrate;
  /** 0 = conservar; en caso contrario remuestrear a esa frecuencia (Hz). */
  sampleRate?: number;
  metadata?: AudioMetadata;
  embedArtwork: boolean;
  writeMetadata: boolean;
  onProgress?: (pct: number) => void;
  /** Duración de la pista (s) para calcular el porcentaje. */
  durationSec?: number;
  /** Prioridad del proceso FFmpeg (best-effort, vía os.setPriority). */
  priority?: 'low' | 'normal' | 'high';
}

export interface ConvertHandle {
  promise: Promise<void>;
  cancel: () => void;
}

/** Construye los argumentos de códec/bitrate según el formato de salida. */
function codecArgs(format: OutputFormat, bitrate: Mp3Bitrate): string[] {
  switch (format) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', `${bitrate}k`];
    case 'flac':
      return ['-c:a', 'flac'];
    case 'wav':
      return ['-c:a', 'pcm_s16le'];
    case 'm4a':
      return ['-c:a', 'aac', '-b:a', `${bitrate}k`];
    case 'aac':
      // AAC crudo en contenedor ADTS.
      return ['-c:a', 'aac', '-b:a', `${bitrate}k`, '-f', 'adts'];
    case 'aiff':
      return ['-c:a', 'pcm_s16be'];
    default:
      return [];
  }
}

function metadataArgs(meta: AudioMetadata): string[] {
  const args: string[] = [];
  const add = (k: string, v?: string | number) => {
    if (v !== undefined && v !== null && v !== '') args.push('-metadata', `${k}=${v}`);
  };
  add('title', meta.title);
  add('artist', meta.artist);
  add('album', meta.album);
  add('album_artist', meta.albumArtist);
  add('genre', meta.genre);
  add('date', meta.year);
  add('track', meta.trackNumber);
  add('disc', meta.discNumber);
  add('comment', meta.comment);
  add('composer', meta.composer);
  add('TSRC', meta.isrc); // ISRC: clave estándar en ID3v2 / contenedores compatibles
  return args;
}

/** Parsea "time=HH:MM:SS.xx" del stderr de ffmpeg a segundos. */
export function parseFfmpegTime(line: string): number | null {
  const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Lanza una conversión. Devuelve un handle con la promesa y un `cancel()` que
 * mata el proceso (usado por el timeout y por la cancelación manual).
 */
export function convert(opts: ConvertOptions): ConvertHandle {
  const bin = resolveFfmpegPath();
  mkdirSync(dirname(opts.output), { recursive: true });

  const args: string[] = ['-y', '-i', opts.input];

  // La portada incrustada solo es válida en contenedores que la soportan
  // (MP3/M4A). En WAV/FLAC se ignora para no provocar un fallo de ffmpeg.
  const artSupported = opts.format === 'mp3' || opts.format === 'm4a';
  const hasArt = Boolean(
    artSupported && opts.embedArtwork && opts.metadata?.artworkPath
    && existsSync(opts.metadata.artworkPath),
  );
  if (hasArt) {
    args.push('-i', opts.metadata!.artworkPath!);
    args.push('-map', '0:a', '-map', '1:v');
  }

  args.push(...codecArgs(opts.format, opts.mp3Bitrate));

  // Remuestreo opcional del audio (no aplicar al stream de portada).
  if (opts.sampleRate && opts.sampleRate > 0) {
    args.push('-ar:a', String(opts.sampleRate));
  }

  if (hasArt) {
    args.push('-c:v', 'mjpeg', '-disposition:v', 'attached_pic', '-id3v2_version', '3');
  }

  if (opts.writeMetadata && opts.metadata) {
    args.push(...metadataArgs(opts.metadata));
  }

  args.push('-progress', 'pipe:2', opts.output);

  let child: ChildProcess | null = null;
  let cancelled = false;

  const promise = new Promise<void>((resolve, reject) => {
    child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    activeChildren.add(child);
    child.once('close', () => { if (child) activeChildren.delete(child); });
    // Prioridad de proceso best-effort (no crítico si falla).
    if (opts.priority && opts.priority !== 'normal' && child.pid) {
      try {
        const nice = opts.priority === 'low' ? 10 : -5;
        osSetPriority(child.pid, nice);
      } catch {
        /* sin permisos o no soportado */
      }
    }
    let stderr = '';

    child.stderr?.on('data', (buf: Buffer) => {
      const text = buf.toString();
      stderr += text;
      if (stderr.length > 16_000) stderr = stderr.slice(-16_000);
      if (opts.onProgress && opts.durationSec && opts.durationSec > 0) {
        for (const line of text.split('\n')) {
          const t = parseFfmpegTime(line);
          if (t != null) {
            const pct = Math.min(99, Math.round((t / opts.durationSec) * 100));
            opts.onProgress(pct);
          }
        }
      }
    });

    child.on('error', (err) => reject(err));

    child.on('close', (code) => {
      if (cancelled) {
        reject(new Error('Conversión cancelada'));
        return;
      }
      if (code === 0) {
        // Validar que el archivo de salida existe y no está vacío.
        try {
          const st = statSync(opts.output);
          if (st.size <= 0) {
            reject(new Error('El archivo de salida está vacío (0 bytes)'));
            return;
          }
        } catch {
          reject(new Error('El archivo de salida no se generó'));
          return;
        }
        opts.onProgress?.(100);
        resolve();
      } else {
        const tail = stderr.split('\n').filter(Boolean).slice(-4).join(' | ');
        reject(new Error(`ffmpeg salió con código ${code}: ${tail}`));
      }
    });
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      if (child && !child.killed) child.kill('SIGKILL');
    },
  };
}
