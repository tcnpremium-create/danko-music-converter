// Pruebas de las operaciones nuevas de AppService (fase final):
// edición de metadatos, encolar pista individual, eliminar y biblioteca.
import { describe, it, expect, beforeAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { initSqlRuntime, Database } from '../../database/Database.js';
import { AppService, type AppPaths } from '../../services/AppService.js';

beforeAll(async () => { await initSqlRuntime(); });

function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(join(dir, e.name)) : 1;
  }
  return n;
}

async function makeService(root: string): Promise<AppService> {
  const paths: AppPaths = {
    dbPath: join(root, 'danko.sqlite'),
    workDir: join(root, 'work'),
    defaultOutputDir: join(root, 'out'),
  };
  const db = await Database.open(paths.dbPath);
  const svc = new AppService(db, paths);
  svc.updateSettings({
    demo: { trackCount: 5, errorProbability: 0, speedBytesPerSec: 500 * 1024 * 1024, forcedFailureIndex: null },
  });
  return svc;
}

function drained(svc: AppService, ms = 60000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no drenó')), ms);
    svc.queue.on('drained', () => { clearTimeout(t); resolve(); });
  });
}

describe('AppService — operaciones de pista y biblioteca', () => {
  it('edita metadatos de una pista y persiste', async () => {
    const svc = await makeService(mkdtempSync(join(tmpdir(), 'danko-md-')));
    const { tracks } = svc.importDemoPlaylist(3);
    const updated = svc.updateTrackMetadata(tracks[0].id, { title: 'Nuevo Título', artist: 'Nuevo Artista' });
    expect(updated?.metadata.title).toBe('Nuevo Título');
    expect(updated?.metadata.artist).toBe('Nuevo Artista');
    // Persistido:
    const reread = svc.getTracks(tracks[0].playlistId).find((t) => t.id === tracks[0].id);
    expect(reread?.metadata.title).toBe('Nuevo Título');
  });

  it('encola una única pista', async () => {
    const svc = await makeService(mkdtempSync(join(tmpdir(), 'danko-1-')));
    const { tracks } = svc.importDemoPlaylist(3);
    const job = svc.enqueueTrack(tracks[1].id);
    expect(job).not.toBeNull();
    expect(job!.trackId).toBe(tracks[1].id);
    expect(svc.queue.getJobs()).toHaveLength(1);
  });

  it('elimina una pista', async () => {
    const svc = await makeService(mkdtempSync(join(tmpdir(), 'danko-rm-')));
    const { playlist, tracks } = svc.importDemoPlaylist(3);
    svc.removeTrack(tracks[0].id);
    expect(svc.getTracks(playlist.id)).toHaveLength(2);
  });

  it('la biblioteca refleja los archivos completados', async () => {
    const svc = await makeService(mkdtempSync(join(tmpdir(), 'danko-lib-')));
    svc.updateSettings({
      queue: { concurrency: 2, maxAttempts: 1, timeoutSec: 30, backoffBaseMs: 5, priority: 'normal' },
      conversion: {
        outputFormat: 'mp3', mp3Bitrate: 128, sampleRate: 0, outputDir: join(svc.getSettings().conversion.outputDir),
        namingTemplate: '{artist} - {title}', embedArtwork: false, writeMetadata: false, duplicatePolicy: 'OMITIR',
      },
    });
    const { playlist } = svc.importDemoPlaylist(3);
    svc.enqueuePlaylist(playlist.id);
    const d = drained(svc); svc.startQueue(); await d;

    const lib = svc.getLibrary();
    expect(lib.length).toBe(3);
    expect(lib.every((i) => i.exists)).toBe(true);
    expect(svc.getPlayablePath(lib[0].path)).toBe(lib[0].path);
    expect(svc.getPlayablePath('/ruta/inexistente.mp3')).toBeNull();
  });
});

describe('AppService — matching Spotify → biblioteca', () => {
  it('puntúa pistas de playlist contra archivos locales y respeta anti-falsos-positivos', async () => {
    const root = mkdtempSync(join(tmpdir(), 'danko-match-'));
    const svc = await makeService(root);
    // Archivo local candidato real (para que getAllLocalTracks lo incluya).
    const localFile = join(root, 'titanium.wav');
    writeFileSync(localFile, Buffer.from('RIFFxxxxWAVE'));

    // Importar 1 archivo local = biblioteca. Como importLocalFiles lee metadata
    // real (archivo falso → fallback), insertamos la pista directamente vía demo
    // no sirve (sin sourcePath). Usamos la API pública de importación:
    const db = (svc as unknown as { db: import('../../database/Database.js').Database }).db;
    const { uuid } = await import('../../utils/id.js');
    const { trackDupHash } = await import('../../providers/DemoProvider.js');
    const localPlaylistId = uuid();
    db.upsertPlaylist({
      id: localPlaylistId, name: 'Local', provider: 'local', trackCount: 1,
      totalDurationSec: 245, estimatedBytes: 1000, createdAt: Date.now(),
    });
    const localTrack = {
      id: uuid(), playlistId: localPlaylistId, position: 1,
      metadata: { title: 'Titanium', artist: 'David Guetta', album: 'Nothing but the Beat' },
      durationSec: 245, sourceFormat: 'wav' as const, sourcePath: localFile,
      provider: 'local' as const, estimatedBytes: 1000,
    };
    db.insertTrack(localTrack, trackDupHash(localTrack));

    // Playlist "Spotify" con dos pistas: una idéntica y un remix de otra duración.
    const spid = uuid();
    db.upsertPlaylist({
      id: spid, name: 'SP', provider: 'spotify', trackCount: 2,
      totalDurationSec: 0, estimatedBytes: 0, createdAt: Date.now(),
    });
    const same = { id: uuid(), playlistId: spid, position: 1,
      metadata: { title: 'Titanium', artist: 'David Guetta', album: 'Nothing but the Beat' },
      durationSec: 245, sourceFormat: 'mp3' as const, provider: 'spotify' as const, estimatedBytes: 0 };
    const remix = { id: uuid(), playlistId: spid, position: 2,
      metadata: { title: 'Titanium (Remix 2024)', artist: 'David Guetta', album: '' },
      durationSec: 312, sourceFormat: 'mp3' as const, provider: 'spotify' as const, estimatedBytes: 0 };
    db.insertTrack(same, trackDupHash(same));
    db.insertTrack(remix, trackDupHash(remix));

    const rows = svc.matchPlaylistToLibrary(spid);
    const rSame = rows.find((r) => r.trackId === same.id)!;
    const rRemix = rows.find((r) => r.trackId === remix.id)!;
    expect(rSame.verdict).toBe('MATCH');
    expect(rSame.candidatePath).toBe(localFile);
    // El remix de distinta duración NO debe auto-asociarse.
    expect(rRemix.verdict).not.toBe('MATCH');
  });
});

describe('AppService — CRUD de playlists', () => {
  it('crea, renombra, duplica y elimina una playlist', async () => {
    const svc = await makeService(mkdtempSync(join(tmpdir(), 'danko-crud-')));
    const { playlist } = svc.importDemoPlaylist(3);

    // Crear vacía
    const empty = svc.createPlaylist('Mi lista');
    expect(empty.name).toBe('Mi lista');
    expect(svc.getTracks(empty.id)).toHaveLength(0);

    // Renombrar
    const renamed = svc.renamePlaylist(empty.id, 'Renombrada');
    expect(renamed?.name).toBe('Renombrada');

    // Duplicar (con pistas y nuevos ids)
    const dup = svc.duplicatePlaylist(playlist.id)!;
    expect(dup.id).not.toBe(playlist.id);
    expect(dup.name).toContain('(copia)');
    const origTracks = svc.getTracks(playlist.id);
    const dupTracks = svc.getTracks(dup.id);
    expect(dupTracks).toHaveLength(origTracks.length);
    expect(dupTracks.every((t) => !origTracks.some((o) => o.id === t.id))).toBe(true);

    // Eliminar (cascada): desaparece la playlist y sus pistas
    svc.deletePlaylist(dup.id);
    expect(svc.getPlaylists().some((p) => p.id === dup.id)).toBe(false);
    expect(svc.getTracks(dup.id)).toHaveLength(0);
  });

  it('reordena pistas dentro de la playlist intercambiando posiciones', async () => {
    const svc = await makeService(mkdtempSync(join(tmpdir(), 'danko-reorder-')));
    const { playlist, tracks } = svc.importDemoPlaylist(3);
    const first = svc.getTracks(playlist.id)[0];
    const second = svc.getTracks(playlist.id)[1];

    svc.reorderTrack(second.id, -1); // sube la segunda al primer puesto
    const after = svc.getTracks(playlist.id);
    expect(after[0].id).toBe(second.id);
    expect(after[1].id).toBe(first.id);
    // No se pierde ninguna pista.
    expect(after).toHaveLength(tracks.length);
  });

  it('exporta M3U con metadatos EXTINF', async () => {
    const svc = await makeService(mkdtempSync(join(tmpdir(), 'danko-m3u-')));
    const { playlist } = svc.importDemoPlaylist(2);
    const m3u = svc.exportPlaylistM3U(playlist.id);
    expect(m3u.startsWith('#EXTM3U')).toBe(true);
    expect(m3u).toContain('#EXTINF:');
  });

  it('eliminar pista recalcula el recuento de la playlist', async () => {
    const svc = await makeService(mkdtempSync(join(tmpdir(), 'danko-recount-')));
    const { playlist, tracks } = svc.importDemoPlaylist(4);
    svc.removeTrack(tracks[0].id);
    const p = svc.getPlaylists().find((x) => x.id === playlist.id)!;
    expect(p.trackCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Flujo de UNA SOLA CANCIÓN (requisito principal de esta fase)
// ---------------------------------------------------------------------------
describe('AppService — flujo de una sola canción', () => {
  async function svcFor(root: string, over: Parameters<AppService['updateSettings']>[0] = {}): Promise<AppService> {
    const svc = await makeService(root);
    svc.updateSettings({
      queue: { concurrency: 3, maxAttempts: 2, timeoutSec: 30, backoffBaseMs: 5, priority: 'normal' },
      conversion: {
        outputFormat: 'mp3', mp3Bitrate: 128, sampleRate: 0, outputDir: svc.getSettings().conversion.outputDir,
        namingTemplate: '{artist} - {title}', embedArtwork: false, writeMetadata: true, duplicatePolicy: 'OMITIR',
      },
      ...over,
    });
    return svc;
  }

  it('procesa 1 canción: 1 job, 1 completada, 1 archivo', async () => {
    const svc = await svcFor(mkdtempSync(join(tmpdir(), 'danko-s1-')));
    const { tracks } = svc.importDemoPlaylist(4);
    svc.enqueueTrack(tracks[0].id);
    const d = drained(svc); svc.startQueue(); await d;
    const snap = svc.queue.snapshot();
    expect(snap.stats.total).toBe(1);
    expect(snap.stats.completed).toBe(1);
    expect(countFiles(svc.getSettings().conversion.outputDir)).toBe(1);
  });

  it('procesar UNA canción NO procesa las demás de la playlist', async () => {
    const svc = await svcFor(mkdtempSync(join(tmpdir(), 'danko-iso-')));
    const { tracks } = svc.importDemoPlaylist(4);
    // Solo la pista índice 2 entra en la cola.
    svc.enqueueTrack(tracks[2].id);
    const d = drained(svc); svc.startQueue(); await d;

    const jobs = svc.queue.getJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].trackId).toBe(tracks[2].id);
    // Ninguna otra pista tiene job.
    for (const other of [tracks[0], tracks[1], tracks[3]]) {
      expect(jobs.some((j) => j.trackId === other.id)).toBe(false);
    }
    // Exactamente 1 archivo generado.
    expect(countFiles(svc.getSettings().conversion.outputDir)).toBe(1);
  });

  it('procesa 2 canciones: 2 jobs, 2 completadas, 2 archivos', async () => {
    const svc = await svcFor(mkdtempSync(join(tmpdir(), 'danko-s2-')));
    const { tracks } = svc.importDemoPlaylist(5);
    svc.enqueueTrack(tracks[0].id);
    svc.enqueueTrack(tracks[3].id);
    const d = drained(svc); svc.startQueue(); await d;
    const snap = svc.queue.snapshot();
    expect(snap.stats.total).toBe(2);
    expect(snap.stats.completed).toBe(2);
    expect(countFiles(svc.getSettings().conversion.outputDir)).toBe(2);
  });

  it('encolar la MISMA canción dos veces no crea un job duplicado', async () => {
    const svc = await svcFor(mkdtempSync(join(tmpdir(), 'danko-dup1-')));
    const { tracks } = svc.importDemoPlaylist(3);
    const j1 = svc.enqueueTrack(tracks[0].id);
    const j2 = svc.enqueueTrack(tracks[0].id); // idempotente mientras esté activo
    expect(j2!.id).toBe(j1!.id);
    expect(svc.queue.getJobs()).toHaveLength(1);
  });

  it('cancela una canción individual', async () => {
    const svc = await svcFor(mkdtempSync(join(tmpdir(), 'danko-cancel-')),
      { demo: { trackCount: 3, errorProbability: 0, speedBytesPerSec: 1024, forcedFailureIndex: null } });
    // Velocidad lenta para que dé tiempo a cancelar durante la preparación.
    const { tracks } = svc.importDemoPlaylist(3);
    const job = svc.enqueueTrack(tracks[0].id)!;
    svc.startQueue();
    await new Promise((r) => setTimeout(r, 50));
    svc.cancelJob(job.id);
    const after = svc.queue.getJobs().find((j) => j.id === job.id)!;
    expect(after.status).toBe('CANCELADO');
  });

  it('una canción que falla queda en ERROR sin bloquear (y se puede reintentar)', async () => {
    // forcedFailureIndex 0 → la pista 0 siempre falla; maxAttempts 2 → acaba ERROR.
    const svc = await svcFor(mkdtempSync(join(tmpdir(), 'danko-err1-')),
      { demo: { trackCount: 3, errorProbability: 0, speedBytesPerSec: 500 * 1024 * 1024, forcedFailureIndex: 0 } });
    const { tracks } = svc.importDemoPlaylist(3);
    const job = svc.enqueueTrack(tracks[0].id)!;
    const d = drained(svc); svc.startQueue(); await d;
    const failed = svc.queue.getJobs().find((j) => j.id === job.id)!;
    expect(failed.status).toBe('ERROR');
    expect(failed.attempts).toBe(2); // reintentó antes de rendirse

    // Reintento manual: quitamos el fallo forzado y reintentamos.
    svc.updateSettings({ demo: { ...svc.getSettings().demo, forcedFailureIndex: null } });
    const d2 = drained(svc); svc.retryJob(job.id); svc.startQueue(); await d2;
    expect(svc.queue.getJobs().find((j) => j.id === job.id)!.status).toBe('COMPLETADO');
  });
});
