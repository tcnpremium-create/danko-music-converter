// ============================================================================
// Emparejado profesional de metadatos (Spotify) con audio local.
//
// Objetivo: puntuar 0-100 la probabilidad de que un archivo local sea la misma
// grabación que una pista de referencia, EVITANDO falsos positivos. El ejemplo
// canónico a evitar: "David Guetta - Titanium" NO debe asociarse automáticamente
// con "David Guetta - Titanium (Remix 2024)" si versión y duración no coinciden.
//
// Puro y sin dependencias → fácilmente testeable.
// ============================================================================

export interface MatchFields {
  artist: string;
  title: string;
  album?: string;
  durationSec?: number;
  trackNumber?: number;
  isrc?: string;
}

export type MatchVerdict = 'MATCH' | 'PROBABLE' | 'REVISAR' | 'SIN_MATCH';

export interface MatchResult {
  score: number; // 0..100
  verdict: MatchVerdict;
  reasons: string[];
}

// Palabras de "versión" que distinguen grabaciones distintas del mismo tema.
const VERSION_TOKENS = [
  'remix', 'live', 'acoustic', 'acustico', 'instrumental', 'extended', 'edit',
  'radio', 'version', 'remaster', 'remastered', 'demo', 'mix', 'club', 'dub',
  'karaoke', 'cover', 'reprise', 'unplugged', 'bonus', 'vip', 'bootleg',
];

// Ruido a eliminar del título (no cambian la identidad de la grabación).
const NOISE_PHRASES = [
  'official video', 'official audio', 'official music video', 'lyric video',
  'lyrics', 'audio', 'hd', 'hq', '4k', 'mv', 'visualizer',
];

/** Quita acentos/diacríticos. */
function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Normaliza un texto para comparación: minúsculas, sin acentos, sin "feat/ft",
 * sin paréntesis/corchetes, sin puntuación, espacios colapsados.
 */
export function normalizeText(input: string): string {
  let s = stripAccents((input ?? '').toLowerCase());
  // Quitar "feat"/"ft"/"featuring" y lo que les sigue hasta separador fuerte.
  s = s.replace(/\b(feat|ft|featuring|con)\b\.?\s+.*$/g, ' ');
  // Quitar contenido entre paréntesis/corchetes (versiones, etc.).
  s = s.replace(/[([{][^)\]}]*[)\]}]/g, ' ');
  // Quitar frases de ruido.
  for (const p of NOISE_PHRASES) s = s.replace(new RegExp(`\\b${p}\\b`, 'g'), ' ');
  // Quitar puntuación → espacios.
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  // Colapsar espacios.
  return s.replace(/\s+/g, ' ').trim();
}

/** Conjunto de tokens de versión presentes en el texto ORIGINAL (con paréntesis). */
export function versionTokens(input: string): Set<string> {
  const s = stripAccents((input ?? '').toLowerCase());
  const found = new Set<string>();
  for (const t of VERSION_TOKENS) {
    if (new RegExp(`\\b${t}\\b`).test(s)) found.add(t);
  }
  return found;
}

/** Distancia de Levenshtein entre dos cadenas. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** Similitud 0..1 basada en Levenshtein normalizada por la longitud mayor. */
export function similarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === '' && nb === '') return 1;
  if (na === '' || nb === '') return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
}

/** Cercanía de duración 0..1: 1 si |diff|<=2s, 0 si |diff|>=10s, lineal entre medias. */
function durationCloseness(a?: number, b?: number): number | null {
  if (a == null || b == null || a <= 0 || b <= 0) return null;
  const diff = Math.abs(a - b);
  if (diff <= 2) return 1;
  if (diff >= 10) return 0;
  return 1 - (diff - 2) / 8;
}

export const THRESHOLDS = { MATCH: 90, PROBABLE: 75, REVISAR: 60 } as const;

export function classify(score: number): MatchVerdict {
  if (score >= THRESHOLDS.MATCH) return 'MATCH';
  if (score >= THRESHOLDS.PROBABLE) return 'PROBABLE';
  if (score >= THRESHOLDS.REVISAR) return 'REVISAR';
  return 'SIN_MATCH';
}

/**
 * Puntúa la coincidencia entre una referencia (p. ej. pista de Spotify) y un
 * candidato local. Devuelve score 0-100, veredicto y motivos.
 */
export function scoreMatch(ref: MatchFields, cand: MatchFields): MatchResult {
  const reasons: string[] = [];

  // 1) ISRC coincidente es prueba fuerte de identidad.
  if (ref.isrc && cand.isrc && ref.isrc.trim().toUpperCase() === cand.isrc.trim().toUpperCase()) {
    return { score: 100, verdict: 'MATCH', reasons: ['ISRC idéntico'] };
  }

  const titleSim = similarity(ref.title, cand.title);
  const artistSim = similarity(ref.artist, cand.artist);
  const albumSim = ref.album && cand.album ? similarity(ref.album, cand.album) : null;
  const durClose = durationCloseness(ref.durationSec, cand.durationSec);

  // Pesos dinámicos según campos disponibles.
  let total = 0;
  let weight = 0;
  const addFactor = (value: number, w: number) => { total += value * w; weight += w; };
  addFactor(titleSim, 0.45);
  addFactor(artistSim, 0.30);
  if (albumSim != null) addFactor(albumSim, 0.10);
  if (durClose != null) addFactor(durClose, 0.15);

  let score = weight > 0 ? (total / weight) * 100 : 0;
  reasons.push(`título ${(titleSim * 100) | 0}%`, `artista ${(artistSim * 100) | 0}%`);
  if (albumSim != null) reasons.push(`álbum ${(albumSim * 100) | 0}%`);
  if (durClose != null) reasons.push(`duración ${(durClose * 100) | 0}%`);

  // 2) GUARDA ANTI-FALSOS-POSITIVOS: distinta "versión".
  const vRef = versionTokens(ref.title);
  const vCand = versionTokens(cand.title);
  const versionMismatch =
    [...vRef].some((t) => !vCand.has(t)) || [...vCand].some((t) => !vRef.has(t));
  if (versionMismatch) {
    // Solo se perdona si la duración es casi idéntica (misma grabación mal etiquetada).
    if (durClose != null && durClose >= 0.9) {
      score -= 8;
      reasons.push('versión distinta pero duración casi idéntica (-8)');
    } else {
      score = Math.min(score, 55); // por debajo de REVISAR → nunca auto-asocia
      reasons.push('versión distinta y duración no concluyente → tope 55');
    }
  }

  // 3) Penalización por número de pista claramente distinto (si ambos existen).
  if (ref.trackNumber && cand.trackNumber && ref.trackNumber !== cand.trackNumber) {
    score -= 5;
    reasons.push('nº de pista distinto (-5)');
  }

  // 4) Si artista o título son muy bajos, no puede ser match aunque el resto suba.
  if (artistSim < 0.5 || titleSim < 0.5) {
    score = Math.min(score, 50);
    reasons.push('artista o título demasiado distintos → tope 50');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, verdict: classify(score), reasons };
}

/**
 * Elige el mejor candidato local para una referencia. Devuelve el de mayor
 * score; si hay empate cercano entre dos "probables", baja a REVISAR para
 * forzar confirmación manual (evita asociar la equivocada).
 */
export function bestMatch(
  ref: MatchFields,
  candidates: MatchFields[],
): { index: number; result: MatchResult } | null {
  if (candidates.length === 0) return null;
  const scored = candidates.map((c, index) => ({ index, result: scoreMatch(ref, c) }));
  scored.sort((a, b) => b.result.score - a.result.score);
  const top = scored[0];
  const second = scored[1];
  if (
    second &&
    top.result.verdict === 'MATCH' &&
    second.result.score >= THRESHOLDS.PROBABLE &&
    top.result.score - second.result.score < 8
  ) {
    // Dos candidatos muy parecidos: no auto-asociar, pedir revisión.
    return {
      index: top.index,
      result: { ...top.result, verdict: 'REVISAR', reasons: [...top.result.reasons, 'empate con otro candidato → revisar'] },
    };
  }
  return top;
}
