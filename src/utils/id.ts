import { randomUUID, createHash } from 'node:crypto';

export const uuid = (): string => randomUUID();

/** Identificador corto legible tipo "JOB-000123". */
export function jobLabel(seq: number): string {
  return `JOB-${String(seq).padStart(6, '0')}`;
}

/**
 * Huella de duplicado basada en metadatos + duración redondeada. Dos pistas con
 * el mismo artista/título y duración cercana (±2 s) colisionan.
 */
export function duplicateHash(
  artist: string,
  title: string,
  durationSec: number,
): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const bucket = Math.round(durationSec / 2); // tolerancia de 2 s
  return createHash('sha1')
    .update(`${norm(artist)}|${norm(title)}|${bucket}`)
    .digest('hex');
}
