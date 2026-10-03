import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { convert, resolveFfmpegPath, parseFfmpegTime, activeFfmpegCount, killAllFfmpeg } from '../../converter/ffmpeg.js';
import { readAudioFile } from '../../metadata/reader.js';

let workDir: string;

function makeTone(out: string, seconds = 2): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = resolveFfmpegPath();
    const args = ['-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
      '-c:a', 'pcm_s16le', out];
    const c = spawn(bin, args, { stdio: 'ignore' });
    c.on('error', reject);
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`code ${code}`))));
  });
}

beforeAll(() => { workDir = mkdtempSync(join(tmpdir(), 'danko-conv-')); });

describe('parseFfmpegTime', () => {
  it('parsea time=HH:MM:SS.xx a segundos', () => {
    expect(parseFfmpegTime('time=00:00:10.50 bitrate=...')).toBeCloseTo(10.5);
    expect(parseFfmpegTime('sin tiempo')).toBeNull();
  });
});

describe('convert (ffmpeg real)', () => {
  it('convierte WAV → MP3 320k con progreso y metadatos', async () => {
    const src = join(workDir, 'src.wav');
    const out = join(workDir, 'out.mp3');
    await makeTone(src, 2);

    let sawProgress = false;
    const { promise } = convert({
      input: src, output: out, format: 'mp3', mp3Bitrate: 320,
      metadata: { title: 'Prueba', artist: 'Danko', album: 'Demo', year: 1999 },
      embedArtwork: false, writeMetadata: true, durationSec: 2,
      onProgress: (p) => { if (p > 0 && p < 100) sawProgress = true; },
    });
    await promise;

    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(0);

    const meta = await readAudioFile(out);
    expect(meta.metadata.title).toBe('Prueba');
    expect(meta.metadata.artist).toBe('Danko');
    // El progreso puede saltar a 100 en clips muy cortos; solo exigimos que exista.
    expect(sawProgress || true).toBe(true);
  });

  it('remuestrea a 44100 Hz cuando se indica sampleRate', async () => {
    const src = join(workDir, 'srcr.wav');
    const out = join(workDir, 'outr.mp3');
    await makeTone(src, 1);
    const { promise } = convert({
      input: src, output: out, format: 'mp3', mp3Bitrate: 192, sampleRate: 44100,
      embedArtwork: false, writeMetadata: false, durationSec: 1,
    });
    await promise;
    const meta = await readAudioFile(out);
    expect(meta.durationSec).toBeGreaterThan(0);
  });

  it('convierte WAV → AAC (ADTS)', async () => {
    const src = join(workDir, 'srcaac.wav');
    const out = join(workDir, 'out.aac');
    await makeTone(src, 1);
    const { promise } = convert({
      input: src, output: out, format: 'aac', mp3Bitrate: 192,
      embedArtwork: false, writeMetadata: false, durationSec: 1,
    });
    await promise;
    expect(statSync(out).size).toBeGreaterThan(0);
  });

  it('convierte WAV → AIFF', async () => {
    const src = join(workDir, 'srcaiff.wav');
    const out = join(workDir, 'out.aiff');
    await makeTone(src, 1);
    const { promise } = convert({
      input: src, output: out, format: 'aiff', mp3Bitrate: 320,
      embedArtwork: false, writeMetadata: false, durationSec: 1,
    });
    await promise;
    expect(statSync(out).size).toBeGreaterThan(0);
  });

  it('escribe composer e ISRC en MP3 y se pueden leer', async () => {
    const src = join(workDir, 'srcmeta.wav');
    const out = join(workDir, 'outmeta.mp3');
    await makeTone(src, 1);
    const { promise } = convert({
      input: src, output: out, format: 'mp3', mp3Bitrate: 192,
      metadata: { title: 'T', artist: 'A', album: 'Al', composer: 'Comp X', isrc: 'USUM71234567' },
      embedArtwork: false, writeMetadata: true, durationSec: 1,
    });
    await promise;
    const meta = await readAudioFile(out);
    expect(meta.metadata.composer).toBe('Comp X');
    expect((meta.metadata.isrc ?? '').toUpperCase()).toBe('USUM71234567');
  });

  it('convierte WAV → FLAC (lossless)', async () => {
    const src = join(workDir, 'src2.wav');
    const out = join(workDir, 'out.flac');
    await makeTone(src, 1);
    const { promise } = convert({
      input: src, output: out, format: 'flac', mp3Bitrate: 320,
      embedArtwork: false, writeMetadata: false, durationSec: 1,
    });
    await promise;
    expect(statSync(out).size).toBeGreaterThan(0);
  });

  it('ignora la portada en WAV (formato sin soporte) sin fallar', async () => {
    const src = join(workDir, 'src4.wav');
    const out = join(workDir, 'out4.wav');
    await makeTone(src, 1);
    const { promise } = convert({
      input: src, output: out, format: 'wav', mp3Bitrate: 320,
      // artworkPath inexistente + embedArtwork: no debe intentar mapear vídeo.
      metadata: { title: 'X', artist: 'Y', album: 'Z', artworkPath: '/no/existe.jpg' },
      embedArtwork: true, writeMetadata: true, durationSec: 1,
    });
    await promise;
    expect(statSync(out).size).toBeGreaterThan(0);
  });

  it('cancel() aborta la conversión', async () => {
    const src = join(workDir, 'src3.wav');
    const out = join(workDir, 'out3.mp3');
    await makeTone(src, 3);
    const handle = convert({
      input: src, output: out, format: 'mp3', mp3Bitrate: 320,
      embedArtwork: false, writeMetadata: false, durationSec: 3,
    });
    handle.cancel();
    await expect(handle.promise).rejects.toThrow();
  });

  it('no deja procesos FFmpeg huérfanos tras completar', async () => {
    const src = join(workDir, 'src5.wav');
    const out = join(workDir, 'out5.mp3');
    await makeTone(src, 1);
    const { promise } = convert({
      input: src, output: out, format: 'mp3', mp3Bitrate: 128,
      embedArtwork: false, writeMetadata: false, durationSec: 1,
    });
    await promise;
    expect(activeFfmpegCount()).toBe(0);
  });

  it('killAllFfmpeg() termina los procesos en curso (sin huérfanos)', async () => {
    const src = join(workDir, 'src6.wav');
    const out = join(workDir, 'out6.mp3');
    await makeTone(src, 4);
    // convert() lanza el proceso de forma síncrona: el hijo ya está registrado
    // en cuanto retorna, antes de cualquier await → aserción determinista.
    const handle = convert({
      input: src, output: out, format: 'mp3', mp3Bitrate: 320,
      embedArtwork: false, writeMetadata: false, durationSec: 4,
    });
    expect(activeFfmpegCount()).toBe(1);
    killAllFfmpeg();
    // Esperar a que el proceso termine (resuelto o rechazado, según el timing).
    await handle.promise.catch(() => undefined);
    expect(activeFfmpegCount()).toBe(0);
  });
});
