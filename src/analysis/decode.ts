// Decode any audio file to mono PCM (Float32 in [-1,1]) using FFmpeg.
// Scoped and safe: fixed argv array (no shell), only reads the given path.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolveFfmpegPath } from '../converter/ffmpeg.js';

export const ANALYSIS_SAMPLE_RATE = 22050;

export interface DecodedPcm { pcm: Float32Array; sampleRate: number; }

/**
 * Decode to mono s16le at `sampleRate`. Returns null if the file is missing or
 * FFmpeg fails. `maxSeconds` caps how much audio is decoded (analysis windows
 * don't need the whole track and this bounds memory/CPU).
 */
export function decodeToMonoPcm(path: string, sampleRate = ANALYSIS_SAMPLE_RATE, maxSeconds = 120): DecodedPcm | null {
  if (!path || !existsSync(path)) return null;
  const bin = resolveFfmpegPath();
  const args = [
    '-v', 'error',
    '-i', path,
    '-t', String(maxSeconds),
    '-ac', '1',
    '-ar', String(sampleRate),
    '-f', 's16le',
    '-',
  ];
  const res = spawnSync(bin, args, { maxBuffer: 1024 * 1024 * 256 });
  if (res.status !== 0 || !res.stdout || res.stdout.length < 2) return null;
  const buf = res.stdout as Buffer;
  const n = Math.floor(buf.length / 2);
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) pcm[i] = buf.readInt16LE(i * 2) / 32768;
  return { pcm, sampleRate };
}
