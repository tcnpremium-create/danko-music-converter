// ============================================================================
// Sanitización de nombres y rutas para el sistema de archivos de Windows
// ============================================================================

// Caracteres prohibidos en nombres de archivo de Windows: \ / : * ? " < > |
const INVALID_CHARS = /[\\/:*?"<>|]/g;
// Caracteres de control (0x00-0x1F)
const CONTROL_CHARS = /[\u0000-\u001f]/g;
// Nombres de dispositivo reservados en Windows.
const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/**
 * Convierte un texto arbitrario en un segmento de nombre de archivo válido en
 * Windows. Sustituye caracteres inválidos, colapsa espacios, recorta puntos y
 * espacios finales (que Windows elimina silenciosamente) y evita nombres
 * reservados. Nunca devuelve cadena vacía.
 */
export function sanitizeSegment(input: string, fallback = 'sin_titulo'): string {
  let s = (input ?? '').normalize('NFC');
  s = s.replace(INVALID_CHARS, '_').replace(CONTROL_CHARS, '');
  s = s.replace(/\s+/g, ' ').trim();
  // Windows recorta puntos/espacios al final de cada segmento.
  s = s.replace(/[. ]+$/g, '');
  if (s.length === 0) return fallback;
  const base = s.split('.')[0].toUpperCase();
  if (RESERVED_NAMES.has(base)) s = `_${s}`;
  // Límite conservador por segmento.
  if (s.length > 180) s = s.slice(0, 180).trim();
  return s.length === 0 ? fallback : s;
}

/**
 * Genera una ruta relativa (sin extensión) a partir de una plantilla y los
 * metadatos. Cada segmento entre separadores "/" se sanitiza por separado, de
 * modo que "{artist}/{album}" produce subcarpetas reales.
 *
 * Tokens: {artist} {title} {album} {albumArtist} {track} {disc} {year} {genre}
 */
export function applyNamingTemplate(
  template: string,
  meta: {
    artist?: string;
    title?: string;
    album?: string;
    albumArtist?: string;
    trackNumber?: number;
    discNumber?: number;
    year?: number;
    genre?: string;
  },
): string {
  const pad2 = (n?: number) => (n && n > 0 ? String(n).padStart(2, '0') : '');
  // Los separadores de ruta dentro de un VALOR de token no deben crear carpetas:
  // se neutralizan antes de sustituir. Solo los "/" de la PLANTILLA lo hacen.
  const noSep = (s: string) => s.replace(/[\\/]/g, '_');
  const tokens: Record<string, string> = {
    '{artist}': noSep(meta.artist ?? ''),
    '{title}': noSep(meta.title ?? ''),
    '{album}': noSep(meta.album ?? ''),
    '{albumArtist}': noSep(meta.albumArtist ?? meta.artist ?? ''),
    '{track}': pad2(meta.trackNumber),
    '{disc}': pad2(meta.discNumber),
    '{year}': meta.year ? String(meta.year) : '',
    '{genre}': noSep(meta.genre ?? ''),
  };

  let out = template;
  for (const [tok, val] of Object.entries(tokens)) {
    out = out.split(tok).join(val);
  }

  // Sanitizar cada segmento de carpeta por separado; descartar segmentos vacíos.
  // Se limpian separadores colgantes (" - ", " _ ") que deja un token vacío.
  const stripDangling = (s: string) =>
    s.replace(/^[\s\-_]+/, '').replace(/[\s\-_]+$/, '');
  const segments = out
    .split('/')
    .map((seg) => stripDangling(seg))
    .filter((seg) => seg.trim().length > 0) // descartar segmentos vacíos antes del fallback
    .map((seg) => sanitizeSegment(seg));

  if (segments.length === 0) return sanitizeSegment(meta.title ?? '', 'pista');
  return segments.join('/');
}
