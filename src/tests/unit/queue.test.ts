import { describe, it, expect, vi } from 'vitest';
import { QueueEngine, type JobProcessor } from '../../queue/QueueEngine.js';
import type { Job, QueueSettings } from '../../types/index.js';

function makeJobs(n: number): Job[] {
  const now = Date.now();
  return Array.from({ length: n }, (_, i) => ({
    id: `job-${i}`, playlistId: 'p1', trackId: `t-${i}`, status: 'PENDIENTE' as const,
    progress: 0, attempts: 0, maxAttempts: 3, nextAttemptAt: null, error: null,
    outputPath: null, outputBytes: null, createdAt: now + i, updatedAt: now + i,
  }));
}

const settings = (over: Partial<QueueSettings> = {}): QueueSettings => ({
  concurrency: 3, maxAttempts: 3, timeoutSec: 30, backoffBaseMs: 5, priority: 'normal', ...over,
});

const noopPersistence = () => ({
  saveJob: vi.fn(), logError: vi.fn(), onComplete: vi.fn(), onFinalError: vi.fn(),
});

function waitDrained(q: QueueEngine, ms = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('la cola no drenó a tiempo')), ms);
    q.on('drained', () => { clearTimeout(timer); resolve(); });
  });
}

describe('QueueEngine', () => {
  it('procesa todos los jobs con éxito respetando la concurrencia', async () => {
    let peak = 0;
    let active = 0;
    const processor: JobProcessor = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { outputPath: '/out', outputBytes: 100 };
    };
    const q = new QueueEngine(settings({ concurrency: 3 }), processor, noopPersistence());
    q.load(makeJobs(20));
    const drained = waitDrained(q);
    q.start();
    await drained;

    expect(peak).toBeLessThanOrEqual(3);
    expect(q.getJobs().every((j) => j.status === 'COMPLETADO')).toBe(true);
    expect(q.stats().completed).toBe(20);
  });

  it('PRUEBA ESPECIAL: la canción 47 falla, la cola continúa y se reintenta', async () => {
    const attemptsByJob = new Map<string, number>();
    let failCountFor47 = 0;
    const processor: JobProcessor = async (job) => {
      const n = (attemptsByJob.get(job.id) ?? 0) + 1;
      attemptsByJob.set(job.id, n);
      // job-46 es la "canción 47" (0-indexado). Falla la 1ª vez, luego pasa.
      if (job.id === 'job-46') {
        if (n === 1) { failCountFor47++; throw new Error('fallo deliberado 47'); }
      }
      await new Promise((r) => setTimeout(r, 2));
      return { outputPath: '/out', outputBytes: 100 };
    };

    const q = new QueueEngine(settings({ concurrency: 4 }), processor, noopPersistence());
    q.load(makeJobs(100));
    const drained = waitDrained(q);
    q.start();
    await drained;

    const jobs = q.getJobs();
    // La 47 se reintentó (2 intentos) y acabó completada.
    const j47 = jobs.find((j) => j.id === 'job-46')!;
    expect(failCountFor47).toBe(1);
    expect(j47.attempts).toBe(2);
    expect(j47.status).toBe('COMPLETADO');
    // Las vecinas 46 y 48 completaron sin verse afectadas.
    expect(jobs.find((j) => j.id === 'job-45')!.status).toBe('COMPLETADO');
    expect(jobs.find((j) => j.id === 'job-47')!.status).toBe('COMPLETADO');
    // NINGÚN job quedó cancelado: un fallo no detiene la cola.
    expect(jobs.some((j) => j.status === 'CANCELADO')).toBe(false);
    // Las 100 acabaron completadas.
    expect(jobs.filter((j) => j.status === 'COMPLETADO').length).toBe(100);
  });

  it('marca ERROR tras agotar los reintentos, sin detener el resto', async () => {
    const processor: JobProcessor = async (job) => {
      if (job.id === 'job-5') throw new Error('siempre falla');
      return { outputPath: '/out', outputBytes: 50 };
    };
    const q = new QueueEngine(settings({ maxAttempts: 3 }), processor, noopPersistence());
    q.load(makeJobs(10));
    const drained = waitDrained(q);
    q.start();
    await drained;

    const j5 = q.getJobs().find((j) => j.id === 'job-5')!;
    expect(j5.status).toBe('ERROR');
    expect(j5.attempts).toBe(3);
    expect(q.stats().completed).toBe(9);
    expect(q.stats().errors).toBe(1);
  });

  it('operaciones globales: cancelAll, retryFailed, clearCompleted/Failed, removeJob', async () => {
    const processor: JobProcessor = async (job) => {
      if (job.id === 'job-1') throw new Error('falla');
      return { outputPath: '/out', outputBytes: 10 };
    };
    const q = new QueueEngine(settings({ maxAttempts: 1, concurrency: 2 }), processor, noopPersistence());
    q.load(makeJobs(4));
    await new Promise<void>((res) => { q.on('drained', () => res()); q.start(); });
    // job-1 ERROR, el resto COMPLETADO.
    expect(q.stats().errors).toBe(1);
    expect(q.stats().completed).toBe(3);

    // clearCompleted elimina los 3 completados.
    expect(q.clearCompleted()).toBe(3);
    expect(q.getJobs()).toHaveLength(1);

    // retryFailed re-encola el que estaba en ERROR.
    expect(q.retryFailed()).toBe(1);
    expect(q.getJobs()[0].status).toBe('PENDIENTE');

    // removeJob lo elimina.
    q.removeJob(q.getJobs()[0].id);
    expect(q.getJobs()).toHaveLength(0);
  });

  it('cancelAll cancela los no terminales', async () => {
    const processor: JobProcessor = async () => {
      await new Promise((r) => setTimeout(r, 200));
      return { outputPath: '/o', outputBytes: 1 };
    };
    const q = new QueueEngine(settings({ concurrency: 1 }), processor, noopPersistence());
    q.load(makeJobs(5));
    q.start();
    await new Promise((r) => setTimeout(r, 30));
    q.cancelAll();
    expect(q.getJobs().every((j) => ['CANCELADO', 'COMPLETADO', 'PROCESANDO'].includes(j.status))).toBe(true);
    expect(q.getJobs().filter((j) => j.status === 'PENDIENTE')).toHaveLength(0);
  });

  it('reorderJob intercambia el orden de la cola', () => {
    const q = new QueueEngine(settings(), async () => ({ outputPath: '/o', outputBytes: 1 }), noopPersistence());
    q.load(makeJobs(3));
    const before = q.getJobs().map((j) => j.id);
    q.reorderJob(before[2], -1); // subir el último
    const after = q.getJobs().map((j) => j.id);
    expect(after[1]).toBe(before[2]);
    expect(after[2]).toBe(before[1]);
  });

  it('permite reintento manual de un job en ERROR', async () => {
    let failFive = true;
    const processor: JobProcessor = async (job) => {
      if (job.id === 'job-2' && failFive) throw new Error('fallo temporal');
      return { outputPath: '/out', outputBytes: 50 };
    };
    const q = new QueueEngine(settings({ maxAttempts: 1 }), processor, noopPersistence());
    q.load(makeJobs(5));
    await new Promise<void>((res) => { q.on('drained', () => res()); q.start(); });

    expect(q.getJobs().find((j) => j.id === 'job-2')!.status).toBe('ERROR');
    failFive = false;
    const drained2 = new Promise<void>((res) => q.on('drained', () => res()));
    q.retryJob('job-2');
    q.start();
    await drained2;
    expect(q.getJobs().find((j) => j.id === 'job-2')!.status).toBe('COMPLETADO');
  });
});
