// ============================================================================
// Lectura de metadatos de archivos de audio locales con music-metadata.
// ============================================================================
import { parseFile } from 'music-metadata';
import { basename, extname } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AudioMetadata, AudioFormat } from '../types/index.js';

const EXT_TO_FORMAT: Record<string, AudioFormat> = {
  '.mp3': 'mp3', '.wav': 'wav', '.flac': 'flac',
  '.m4a': 'm4a', '.aac': 'aac', '.ogg': 'ogg',
};

export function formatFromPath(path: string): AudioFormat | null {
  return EXT_TO_FORMAT[extname(path).toLowerCase()] ?? null;
}

export interface ReadResult {
  metadata: AudioMetadata;
  durationSec: number;
  format: AudioFormat;
}

/**
 * Lee metadatos y duración de un archivo local. Si hay portada incrustada y se
 * indica `artworkDir`, la extrae a un archivo para poder previsualizarla/reusarla.
 */
export async function readAudioFile(path: string, artworkDir?: string): Promise<ReadResult> {
  const fmt = formatFromPath(path) ?? 'mp3';
  const parsed = await parseFile(path, { duration: true });
  const c = parsed.common;

  let artworkPath: string | undefined;
  const pic = c.picture?.[0];
  if (pic && artworkDir) {
    mkdirSync(artworkDir, { recursive: true });
    const ext = pic.format.includes('png') ? 'png' : 'jpg';
    artworkPath = join(artworkDir, `${basename(path)}.cover.${ext}`);
    writeFileSync(artworkPath, Buffer.from(pic.data));
  }

  const metadata: AudioMetadata = {
    title: c.title ?? basename(path, extname(path)),
    artist: c.artist ?? 'Desconocido',
    album: c.album ?? 'Desconocido',
    albumArtist: c.albumartist ?? undefined,
    genre: c.genre?.[0] ?? undefined,
    year: c.year ?? undefined,
    trackNumber: c.track?.no ?? undefined,
    discNumber: c.disk?.no ?? undefined,
    comment: Array.isArray(c.comment)
      ? (c.comment[0] as unknown as string) ?? undefined
      : undefined,
    composer: c.composer?.[0] ?? undefined,
    isrc: c.isrc?.[0] ?? undefined,
    artworkPath,
  };

  return { metadata, durationSec: parsed.format.duration ?? 0, format: fmt };
}
