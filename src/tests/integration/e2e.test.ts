// ============================================================================
// Prueba de extremo a extremo del pipeline real (AppService + ffmpeg + SQLite),
// sin la capa Electron. Cubre los criterios de finalización del proyecto.
// ============================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, existsSync, readdirSync, statSync } from 'node:fs';
import { initSqlRuntime, Database } from '../../database/Database.js';
import { AppService } from '../../services/AppService.js';
import type { AppPaths } from '../../services/AppService.js';

beforeAll(async () => { await initSqlRuntime(); });

function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(join(dir, e.name));
    else n++;
  }
  return n;
}

async function makeService(root: string): Promise<{ svc: AppService; paths: AppPaths; db: Database }> {
  const paths: AppPaths = {
    dbPath: join(root, 'danko.sqlite'),
    workDir: join(root, 'work'),
    defaultOutputDir: join(root, 'out'),
  };
  const db = await Database.open(paths.dbPath);
  const svc = new AppService(db, paths);
  return { svc, paths, db };
}

function drained(svc: AppService, ms = 60000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no drenó')), ms);
    svc.queue.on('drained', () => { clearTimeout(t); resolve(); });
  });
}

describe('E2E: pipeline completo DANKO', () => {
  it('procesa una playlist demo, la 4ª falla a propósito, la cola continúa y el resto se completa', async () => {
    const root = mkdtempSync(join(tmpdir(), 'danko-e2e-'));
    const { svc, paths } = await makeService(root);

    // Config: demo rápida, 2 reintentos, fallo forzado en índice 3 (4ª canción).
    svc.updateSettings({
      queue: { concurrency: 3, maxAttempts: 2, timeoutSec: 30, backoffBaseMs: 5, priority: 'normal' },
      demo: { trackCount: 8, errorProbability: 0, speedBytesPerSec: 500 * 1024 * 1024, forcedFailureIndex: 3 },
      conversion: {
        outputFormat: 'mp3', mp3Bitrate: 192, sampleRate: 0, outputDir: paths.defaultOutputDir,
        namingTemplate: '{artist}/{album}/{track} - {title}', embedArtwork: false,
        writeMetadata: true, duplicatePolicy: 'OMITIR',
      },
    });

    // TEST 2: importar playlist demo.
    const { playlist } = svc.importDemoPlaylist(8);
    expect(playlist.trackCount).toBe(8);

    // TEST 3: encolar.
    const jobs = svc.enqueuePlaylist(playlist.id);
    expect(jobs).toHaveLength(8);

    // TEST 4-7: procesar; la 4ª falla, se reintenta y acaba en ERROR; el resto completa.
    const d = drained(svc);
    svc.startQueue();
    await d;

    const snap = svc.queue.snapshot();
    expect(snap.stats.total).toBe(8);
    expect(snap.stats.completed).toBe(7);
    expect(snap.stats.errors).toBe(1);

    const failed = snap.jobs.find((j) => j.status === 'ERROR')!;
    expect(failed.attempts).toBe(2); // se reintentó
    // Las demás completaron sin verse afectadas.
    expect(snap.jobs.filter((j) => j.status === 'COMPLETADO').length).toBe(7);

    // TEST 11: los completados generaron archivos reales (7, sin duplicar).
    expect(countFiles(paths.defaultOutputDir)).toBe(7);
    for (const j of snap.jobs.filter((x) => x.status === 'COMPLETADO')) {
      expect(existsSync(j.outputPath!)).toBe(true);
      expect(statSync(j.outputPath!).size).toBeGreaterThan(0);
    }

    // Historial: 8 entradas (7 OK + 1 ERROR).
    expect(svc.getHistory().length).toBe(8);
  });

  it('recupera una cola interrumpida tras cerrar y reabrir (persistencia real)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'danko-rec-'));
    const first = await makeService(root);
    first.svc.updateSettings({
      conversion: {
        outputFormat: 'mp3', mp3Bitrate: 128, sampleRate: 0, outputDir: join(root, 'out'),
        namingTemplate: '{artist} - {title}', embedArtwork: false, writeMetadata: false,
        duplicatePolicy: 'OMITIR',
      },
      demo: { trackCount: 5, errorProbability: 0, speedBytesPerSec: 500 * 1024 * 1024, forcedFailureIndex: null },
    });
    const { playlist } = first.svc.importDemoPlaylist(5);
    first.svc.enqueuePlaylist(playlist.id); // persistidos como PENDIENTE
    // TEST 8: "cerrar" la app (persistir y soltar la BD).
    first.db.close();

    // TEST 9-10: reabrir → detectar y recuperar la cola.
    const second = await makeService(root);
    const info = second.svc.getInterruptedQueue();
    expect(info).not.toBeNull();
    expect(info!.total).toBe(5);
    expect(info!.pending).toBe(5);

    const resumed = second.svc.resumeInterruptedQueue();
    expect(resumed).toHaveLength(5);

    const d = drained(second.svc);
    second.svc.startQueue();
    await d;
    expect(second.svc.queue.snapshot().stats.completed).toBe(5);
  });

  it('respeta la política de duplicados OMITIR al reprocesar', async () => {
    const root = mkdtempSync(join(tmpdir(), 'danko-dup-'));
    const { svc, paths } = await makeService(root);
    svc.updateSettings({
      queue: { concurrency: 2, maxAttempts: 1, timeoutSec: 30, backoffBaseMs: 5, priority: 'normal' },
      conversion: {
        outputFormat: 'mp3', mp3Bitrate: 128, sampleRate: 0, outputDir: paths.defaultOutputDir,
        namingTemplate: '{artist} - {title}', embedArtwork: false, writeMetadata: false,
        duplicatePolicy: 'OMITIR',
      },
      demo: { trackCount: 3, errorProbability: 0, speedBytesPerSec: 500 * 1024 * 1024, forcedFailureIndex: null },
    });
    const { playlist } = svc.importDemoPlaylist(3);

    svc.enqueuePlaylist(playlist.id);
    let d = drained(svc); svc.startQueue(); await d;
    const after1 = countFiles(paths.defaultOutputDir);

    // Reencolar la MISMA playlist: con OMITIR no debe duplicar archivos.
    svc.enqueuePlaylist(playlist.id);
    d = drained(svc); svc.startQueue(); await d;
    const after2 = countFiles(paths.defaultOutputDir);

    expect(after1).toBe(3);
    expect(after2).toBe(3); // sin duplicados
  });
});
