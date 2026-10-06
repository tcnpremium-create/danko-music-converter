import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildVirtualDjExport } from '../../dj/export.js';
import type { Track, Job } from '../../types/index.js';

const track = (id: string, sourcePath?: string): Track => ({ id, sourcePath, playlistId: 'p', position: 1, metadata: { artist: 'Artista & Invitado', title: 'Título "especial" <live>', album: '' }, durationSec: 120, sourceFormat: 'mp3', provider: 'local', estimatedBytes: 0 });
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

describe('VirtualDJ local export', () => {
  it('exports Unicode paths and versions without editing audio, with invalid entries reported', () => {
    const root = mkdtempSync(join(tmpdir(), 'danko-export-'));
    const original = join(root, 'Música & canción.mp3');
    const remix = join(root, 'Música remix.mp3');
    const empty = join(root, 'empty.mp3');
    const folder = join(root, 'folder.mp3');
    writeFileSync(original, 'original audio fixture');
    writeFileSync(remix, 'different version');
    writeFileSync(empty, '');
    mkdirSync(folder);
    const hashes = [digest(original), digest(remix)];
    const result = buildVirtualDjExport([track('1', original), track('2', original), track('3', remix), track('4', join(root, 'missing.mp3')), track('5'), track('6', empty), track('7', folder)], []);
    expect(result.exported).toBe(2);
    expect(result.omitted.map(item => item.trackId)).toEqual(['2', '4', '5', '6', '7']);
    expect(result.content).toContain('Música &amp; canción.mp3');
    expect(result.content).toContain('&quot;especial&quot; &lt;live&gt;');
    expect(result.content).not.toMatch(/\bbpm=|\bkey=/);
    expect([digest(original), digest(remix)]).toEqual(hashes);
  });

  it('prefers the latest existing completed output, falls back to the original and preserves selection order', () => {
    const root = mkdtempSync(join(tmpdir(), 'danko-output-export-'));
    const original = join(root, 'original.mp3'), output = join(root, 'converted.wav');
    writeFileSync(original, 'original'); writeFileSync(output, 'converted');
    const jobs = [
      { trackId: '1', status: 'COMPLETADO', outputPath: output, updatedAt: 1 },
      { trackId: '1', status: 'COMPLETADO', outputPath: join(root, 'lost.wav'), updatedAt: 2 },
      { trackId: '2', status: 'ERROR', outputPath: output, updatedAt: 3 },
    ] as Job[];
    const result = buildVirtualDjExport([track('1', original), track('2', original)], jobs);
    expect(result.exported).toBe(2);
    expect(result.content.indexOf('converted.wav')).toBeLessThan(result.content.indexOf('original.mp3'));
    expect(result.content).not.toContain('lost.wav');
    expect(result.omitted).toEqual([]);
  });
});
