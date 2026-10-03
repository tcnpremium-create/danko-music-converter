// ============================================================================
// Real audio analysis (no invented values):
//   - BPM via onset-energy-flux autocorrelation.
//   - Musical key via chromagram + Krumhansl-Schmuckler profiles.
//   - Camelot wheel code from key+mode.
// Pure DSP on mono PCM samples (Float32 in [-1,1]); decoding is separate.
// ============================================================================

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Camelot codes indexed by pitch class (0 = C).
const MAJOR_CAMELOT = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B'];
const MINOR_CAMELOT = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A'];

// Krumhansl-Schmuckler key profiles.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export interface KeyResult { key: string; root: number; mode: 'major' | 'minor'; camelot: string; }
export interface AnalysisResult {
  bpm: number | null;
  key: string | null;
  mode: 'major' | 'minor' | null;
  camelot: string | null;
  loudnessDb: number | null;
  durationSec: number;
}

export function keyToCamelot(root: number, mode: 'major' | 'minor'): string {
  const pc = ((root % 12) + 12) % 12;
  return mode === 'major' ? MAJOR_CAMELOT[pc] : MINOR_CAMELOT[pc];
}

export function noteName(root: number): string {
  return NOTE_NAMES[((root % 12) + 12) % 12];
}

// -- BPM ---------------------------------------------------------------------

/** Onset-energy envelope: positive energy flux over short frames. */
export function onsetEnvelope(pcm: Float32Array, sampleRate: number, hop = 512): { env: number[]; frameRate: number } {
  const env: number[] = [];
  let prev = 0;
  for (let i = 0; i + hop <= pcm.length; i += hop) {
    let e = 0;
    for (let j = 0; j < hop; j++) { const s = pcm[i + j]; e += s * s; }
    const flux = Math.max(0, e - prev);
    env.push(flux);
    prev = e;
  }
  return { env, frameRate: sampleRate / hop };
}

/** Estimate BPM in [minBpm,maxBpm] via autocorrelation of the onset envelope. */
export function detectBpm(env: number[], frameRate: number, minBpm = 70, maxBpm = 180): number | null {
  const n = env.length;
  if (n < 8) return null;
  const mean = env.reduce((a, b) => a + b, 0) / n;
  const x = env.map((v) => v - mean);

  const lagMin = Math.max(2, Math.floor((frameRate * 60) / maxBpm));
  const lagMax = Math.min(n - 1, Math.ceil((frameRate * 60) / minBpm));
  if (lagMax <= lagMin) return null;

  let bestLag = -1;
  let best = -Infinity;
  const ac: number[] = [];
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    ac[lag] = s;
    if (s > best) { best = s; bestLag = lag; }
  }
  if (bestLag < 0 || best <= 0) return null;

  // Parabolic interpolation around the peak for sub-frame precision.
  const ym = ac[bestLag - 1] ?? ac[bestLag];
  const y0 = ac[bestLag];
  const yp = ac[bestLag + 1] ?? ac[bestLag];
  const denom = (ym - 2 * y0 + yp);
  const delta = denom !== 0 ? (0.5 * (ym - yp)) / denom : 0;
  const lag = bestLag + Math.max(-1, Math.min(1, delta));

  const bpm = (60 * frameRate) / lag;
  return Math.round(bpm * 10) / 10;
}

// -- Key (chroma + Krumhansl) ------------------------------------------------

/** In-place iterative radix-2 Cooley-Tukey FFT. re/im length must be 2^k. */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/** Accumulate a 12-bin chroma vector from mono PCM. */
export function chromagram(pcm: Float32Array, sampleRate: number, frameSize = 4096, hop = 2048): number[] {
  const chroma = new Array(12).fill(0);
  if (pcm.length < frameSize) return chroma;
  const hann = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frameSize - 1)));
  const re = new Float32Array(frameSize);
  const im = new Float32Array(frameSize);
  const fMin = 50, fMax = 2000;

  for (let start = 0; start + frameSize <= pcm.length; start += hop) {
    for (let i = 0; i < frameSize; i++) { re[i] = pcm[start + i] * hann[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 1; k < frameSize / 2; k++) {
      const freq = (k * sampleRate) / frameSize;
      if (freq < fMin || freq > fMax) continue;
      const mag = Math.hypot(re[k], im[k]);
      if (mag <= 0) continue;
      const midi = 69 + 12 * Math.log2(freq / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += mag;
    }
  }
  return chroma;
}

function correlate(a: number[], profile: number[], rotation: number): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += a[(i + rotation) % 12] * profile[i];
  return sum;
}

/** Best key+mode+camelot from a chroma vector. Returns null if no energy. */
export function detectKeyFromChroma(chroma: number[]): KeyResult | null {
  const total = chroma.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const norm = chroma.map((v) => v / total);
  let best: { root: number; mode: 'major' | 'minor'; score: number } | null = null;
  for (let r = 0; r < 12; r++) {
    const maj = correlate(norm, MAJOR_PROFILE, r);
    const min = correlate(norm, MINOR_PROFILE, r);
    if (!best || maj > best.score) best = { root: r, mode: 'major', score: maj };
    if (!best || min > best.score) best = { root: r, mode: 'minor', score: min };
  }
  if (!best) return null;
  return { key: `${noteName(best.root)} ${best.mode}`, root: best.root, mode: best.mode, camelot: keyToCamelot(best.root, best.mode) };
}

// -- Combined ----------------------------------------------------------------

export function rmsLoudnessDb(pcm: Float32Array): number | null {
  if (pcm.length === 0) return null;
  let s = 0;
  for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
  const rms = Math.sqrt(s / pcm.length);
  if (rms <= 0) return null;
  return Math.round(20 * Math.log10(rms) * 10) / 10;
}

export function analyzePcmMono(pcm: Float32Array, sampleRate: number): AnalysisResult {
  const { env, frameRate } = onsetEnvelope(pcm, sampleRate);
  const bpm = detectBpm(env, frameRate);
  const key = detectKeyFromChroma(chromagram(pcm, sampleRate));
  return {
    bpm,
    key: key?.key ?? null,
    mode: key?.mode ?? null,
    camelot: key?.camelot ?? null,
    loudnessDb: rmsLoudnessDb(pcm),
    durationSec: pcm.length / sampleRate,
  };
}
