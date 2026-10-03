import { describe, it, expect } from 'vitest';
import {
  keyToCamelot, noteName, onsetEnvelope, detectBpm, chromagram, detectKeyFromChroma, analyzePcmMono,
} from '../../analysis/analysis.js';

const SR = 22050;

// A click track: short impulse every `periodSec` seconds.
function clickTrack(bpm: number, seconds: number, sr = SR): Float32Array {
  const pcm = new Float32Array(Math.floor(seconds * sr));
  const period = Math.floor((60 / bpm) * sr);
  for (let i = 0; i < pcm.length; i += period) {
    for (let j = 0; j < 400 && i + j < pcm.length; j++) {
      pcm[i + j] = Math.exp(-j / 40) * (j % 2 ? 1 : -1); // decaying transient
    }
  }
  return pcm;
}

function sine(freq: number, seconds: number, sr = SR): Float32Array {
  const pcm = new Float32Array(Math.floor(seconds * sr));
  for (let i = 0; i < pcm.length; i++) pcm[i] = 0.6 * Math.sin((2 * Math.PI * freq * i) / sr);
  return pcm;
}

describe('analysis — Camelot mapping', () => {
  it('maps major/minor roots to the correct Camelot codes', () => {
    expect(keyToCamelot(0, 'major')).toBe('8B');  // C major
    expect(keyToCamelot(9, 'minor')).toBe('8A');  // A minor
    expect(keyToCamelot(7, 'major')).toBe('9B');  // G major
    expect(keyToCamelot(2, 'minor')).toBe('7A');  // D minor
    expect(noteName(9)).toBe('A');
  });
});

describe('analysis — BPM detection', () => {
  it('detects ~120 BPM on a 120 BPM click track', () => {
    const { env, frameRate } = onsetEnvelope(clickTrack(120, 10), SR);
    const bpm = detectBpm(env, frameRate)!;
    expect(bpm).toBeGreaterThan(116);
    expect(bpm).toBeLessThan(124);
  });

  it('detects ~90 BPM on a 90 BPM click track', () => {
    const { env, frameRate } = onsetEnvelope(clickTrack(90, 12), SR);
    const bpm = detectBpm(env, frameRate)!;
    expect(bpm).toBeGreaterThan(87);
    expect(bpm).toBeLessThan(93);
  });
});

describe('analysis — key detection', () => {
  it('identifies the A pitch class from a 440 Hz sine', () => {
    const chroma = chromagram(sine(440, 4), SR);
    const key = detectKeyFromChroma(chroma)!;
    expect(key).toBeTruthy();
    expect(noteName(key.root)).toBe('A');
    expect(key.camelot).toMatch(/^(11B|8A)$/); // A major (11B) or A minor (8A)
  });
});

describe('analysis — combined', () => {
  it('analyzePcmMono returns a coherent structure (no invented nulls hidden)', () => {
    const r = analyzePcmMono(clickTrack(128, 8), SR);
    expect(r.bpm).not.toBeNull();
    expect(r.durationSec).toBeGreaterThan(7);
    expect(typeof r.loudnessDb === 'number' || r.loudnessDb === null).toBe(true);
  });
});
