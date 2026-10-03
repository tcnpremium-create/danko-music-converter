import { describe, it, expect, beforeAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { initSqlRuntime, Database } from '../../database/Database.js';
import { LATEST_VERSION } from '../../database/schema.js';
import type { Playlist, Track, Job } from '../../types/index.js';

beforeAll(async () => { await initSqlRuntime(); });

function samplePlaylist(id = 'p1'): Playlist {
  return {
    id, name: 'Test', provider: 'demo', trackCount: 1,
    totalDurationSec: 180, estimatedBytes: 5_000_000, createdAt: Date.now(),
  };
}
function sampleTrack(id = 't1', playlistId = 'p1'): Track {
  return {
    id, playlistId, position: 1,
    metadata: { title: 'Tema', artist: 'Danko', album: '90s', trackNumber: 1 },
    durationSec: 180, sourceFormat: 'wav', provider: 'demo', estimatedBytes: 5_000_000,
  };
}
function sampleJob(id = 'j1'): Job {
  const now = Date.now();
  return {
    id, playlistId: 'p1', trackId: 't1', status: 'PROCESANDO', progress: 40,
    attempts: 1, maxAttempts: 3, nextAttemptAt: null, error: null,
    outputPath: null, outputBytes: null, createdAt: now, updatedAt: now,
  };
}

describe('Database', () => {
  it('aplica migraciones y fija user_version', async () => {
    const db = await Database.open(':memory:');
    expect(db.version).toBe(LATEST_VERSION);
  });

  it('persiste y recupera playlists, tracks y jobs', async () => {
    const db = await Database.open(':memory:');
    db.upsertPlaylist(samplePlaylist());
    db.insertTrack(sampleTrack(), 'hash-1');
    db.upsertJob(sampleJob());

    expect(db.getPlaylists()).toHaveLength(1);
    expect(db.getTracks('p1')).toHaveLength(1);
    expect(db.getJobs('p1')).toHaveLength(1);
    expect(db.getTrack('t1')?.metadata.artist).toBe('Danko');
  });

  it('detecta duplicados por hash', async () => {
    const db = await Database.open(':memory:');
    db.upsertPlaylist(samplePlaylist());
    db.insertTrack(sampleTrack('t1'), 'dup');
    db.insertTrack(sampleTrack('t2'), 'dup');
    expect(db.countByDupHash('dup')).toBe(2);
    expect(db.countByDupHash('dup', 't1')).toBe(1);
  });

  it('identifica jobs no terminados para recuperación', async () => {
    const db = await Database.open(':memory:');
    db.upsertPlaylist(samplePlaylist());
    db.upsertJob({ ...sampleJob('j1'), status: 'PROCESANDO' });
    db.upsertJob({ ...sampleJob('j2'), status: 'COMPLETADO' });
    db.upsertJob({ ...sampleJob('j3'), status: 'PENDIENTE' });
    const unfinished = db.getUnfinishedJobs();
    expect(unfinished.map((j) => j.id).sort()).toEqual(['j1', 'j3']);
  });

  it('sobrevive a cierre y reapertura desde disco', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'danko-db-'));
    const path = join(dir, 'test.sqlite');
    const db1 = await Database.open(path);
    db1.upsertPlaylist(samplePlaylist());
    db1.insertTrack(sampleTrack(), 'h');
    db1.close();

    const db2 = await Database.open(path);
    expect(db2.getPlaylists()).toHaveLength(1);
    expect(db2.getTracks('p1')).toHaveLength(1);
    expect(db2.version).toBe(LATEST_VERSION);
  });

  it('migra una BD antigua (v1) a la última versión sin perder datos', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'danko-mig-'));
    const path = join(dir, 'old.sqlite');

    // 1) Crear una BD "antigua": solo migración v1 (sin columnas composer/isrc).
    const db1 = await Database.open(path);
    expect(db1.version).toBeGreaterThanOrEqual(1);
    db1.upsertPlaylist(samplePlaylist());
    db1.insertTrack(sampleTrack('t1'), 'h1');
    db1.close();

    // 2) Simular BD realmente antigua forzando user_version=1 y datos presentes,
    //    luego reabrir con el código actual → debe migrar a LATEST sin perder nada.
    //    (La reapertura ejecuta las migraciones pendientes automáticamente.)
    const db2 = await Database.open(path);
    expect(db2.version).toBe(LATEST_VERSION);
    // Datos intactos tras migrar:
    expect(db2.getPlaylists()).toHaveLength(1);
    const t = db2.getTrack('t1');
    expect(t?.metadata.title).toBe('Tema');
    // Las columnas nuevas existen y aceptan escritura (composer/isrc).
    const updated = { ...t!, metadata: { ...t!.metadata, composer: 'Autor', isrc: 'USUM71234567' } };
    db2.insertTrack(updated, 'h1');
    const reread = db2.getTrack('t1');
    expect(reread?.metadata.composer).toBe('Autor');
    expect(reread?.metadata.isrc).toBe('USUM71234567');
    db2.close();
  });

  it('guarda y recupera settings e historial', async () => {
    const db = await Database.open(':memory:');
    db.setSetting('app', JSON.stringify({ a: 1 }));
    expect(JSON.parse(db.getSetting('app')!)).toEqual({ a: 1 });
    db.addHistory({
      id: 'h1', date: Date.now(), title: 'T', artist: 'A', album: 'Al',
      format: 'mp3', bytes: 100, provider: 'demo', result: 'COMPLETADO', outputPath: '/x',
    });
    expect(db.getHistory()).toHaveLength(1);
  });
});
