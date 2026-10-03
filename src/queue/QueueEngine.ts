// ============================================================================
// Motor de cola profesional.
//
// Garantías de diseño:
//  - Cada pista es un JOB independiente. El fallo de uno NUNCA detiene la cola.
//  - Reintentos con backoff exponencial hasta maxAttempts.
//  - Concurrencia acotada (1..5) para no saturar CPU/RAM/red.
//  - Estado persistido en cada transición → recuperable tras cierre inesperado.
//  - Emite instantáneas (snapshots) para la UI.
//
// El "procesador" de un job es inyectable, de modo que la lógica de cola se
// prueba de forma aislada (sin ffmpeg real) y el fallo de la pista N puede
// forzarse en los tests.
// ============================================================================
import { EventEmitter } from 'node:events';
import type { Job, JobStatus, QueueSettings, DashboardStats, QueueSnapshot } from '../types/index.js';
import { computeBackoff } from '../utils/retry.js';

export interface JobContext {
  onProgress: (pct: number) => void;
  signal: { cancelled: boolean };
}

/** Procesa un job. Debe resolver con los bytes de salida o lanzar en error. */
export type JobProcessor = (job: Job, ctx: JobContext) => Promise<{ outputPath: string; outputBytes: number }>;

export interface QueuePersistence {
  saveJob: (job: Job) => void;
  logError: (jobId: string, message: string, attempt: number) => void;
  onComplete?: (job: Job) => void;
  onFinalError?: (job: Job) => void;
}

const TERMINAL: JobStatus[] = ['COMPLETADO', 'CANCELADO', 'OMITIDO'];

export class QueueEngine extends EventEmitter {
  private jobs = new Map<string, Job>();
  private running = false;
  private active = new Set<string>();
  private signals = new Map<string, { cancelled: boolean }>();
  private tickTimer: NodeJS.Timeout | null = null;
  private settings: QueueSettings;
  private bytesInWindow = 0;
  private windowStart = Date.now();
  private lastSpeed = 0;

  constructor(
    settings: QueueSettings,
    private processor: JobProcessor,
    private persistence: QueuePersistence,
  ) {
    super();
    this.settings = settings;
  }

  updateSettings(s: Partial<QueueSettings>): void {
    this.settings = { ...this.settings, ...s };
  }

  /** Carga jobs (p. ej. recuperados de la BD) en el motor. */
  load(jobs: Job[]): void {
    for (const j of jobs) {
      // Al recuperar, un job que quedó "PROCESANDO"/"ANALIZANDO" se reencola.
      const recovered: Job =
        j.status === 'PROCESANDO' || j.status === 'ANALIZANDO'
          ? { ...j, status: 'PENDIENTE', progress: 0 }
          : j;
      this.jobs.set(recovered.id, recovered);
    }
    this.emitSnapshot();
  }

  getJobs(): Job[] {
    return [...this.jobs.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.windowStart = Date.now();
    this.bytesInWindow = 0;
    this.emit('running', true);
    this.scheduleTick(0);
  }

  pause(): void {
    this.running = false;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    this.emit('running', false);
    this.emitSnapshot();
  }

  /** Cancela un job concreto (si está activo, aborta su procesamiento). */
  cancelJob(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    const sig = this.signals.get(id);
    if (sig) sig.cancelled = true;
    if (!TERMINAL.includes(job.status)) {
      this.transition(job, 'CANCELADO', { progress: 0, error: null, nextAttemptAt: null });
    }
  }

  /** Reintenta manualmente un job en error. */
  retryJob(id: string): void {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'ERROR') return;
    this.transition(job, 'PENDIENTE', {
      progress: 0, error: null, attempts: 0, nextAttemptAt: null,
    });
    if (this.running) this.scheduleTick(0);
  }

  // -- Operaciones globales de cola ------------------------------------------

  /** Cancela todos los jobs no terminales. */
  cancelAll(): void {
    for (const j of this.getJobs()) {
      if (!TERMINAL.includes(j.status) && j.status !== 'ERROR') this.cancelJob(j.id);
    }
    this.emitSnapshot();
  }

  /** Reencola todos los jobs en ERROR. */
  retryFailed(): number {
    let n = 0;
    for (const j of this.getJobs()) {
      if (j.status === 'ERROR') {
        this.transition(j, 'PENDIENTE', { progress: 0, error: null, attempts: 0, nextAttemptAt: null });
        n++;
      }
    }
    if (n > 0 && this.running) this.scheduleTick(0);
    this.emitSnapshot();
    return n;
  }

  /** Elimina de la cola los jobs con el estado dado (solo estados terminales). */
  private clearByStatus(status: JobStatus): number {
    let n = 0;
    for (const j of this.getJobs()) {
      if (j.status === status && !this.active.has(j.id)) {
        this.jobs.delete(j.id);
        n++;
      }
    }
    if (n > 0) this.emitSnapshot();
    return n;
  }

  clearCompleted(): number { return this.clearByStatus('COMPLETADO'); }
  clearFailed(): number { return this.clearByStatus('ERROR'); }

  /** Elimina un job concreto (lo cancela antes si está activo). */
  removeJob(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    if (this.active.has(id) || !TERMINAL.includes(job.status)) this.cancelJob(id);
    this.jobs.delete(id);
    this.emitSnapshot();
  }

  /**
   * Reordena un job pendiente una posición arriba (-1) o abajo (+1) dentro del
   * orden de la cola (basado en createdAt). Solo afecta a jobs no iniciados.
   */
  reorderJob(id: string, direction: -1 | 1): void {
    const ordered = this.getJobs();
    const idx = ordered.findIndex((j) => j.id === id);
    const swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= ordered.length) return;
    const a = ordered[idx];
    const b = ordered[swapIdx];
    // Intercambiar su clave de orden (createdAt) de forma estable.
    const tmp = a.createdAt;
    this.jobs.set(a.id, { ...a, createdAt: b.createdAt });
    this.jobs.set(b.id, { ...b, createdAt: tmp });
    this.persistence.saveJob(this.jobs.get(a.id)!);
    this.persistence.saveJob(this.jobs.get(b.id)!);
    this.emitSnapshot();
  }

  private scheduleTick(delay: number): void {
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.tickTimer = setTimeout(() => this.tick(), delay);
  }

  /** Bucle principal: rellena los huecos de concurrencia con jobs elegibles. */
  private tick(): void {
    if (!this.running) return;

    const now = Date.now();
    const capacity = this.settings.concurrency - this.active.size;

    if (capacity > 0) {
      const eligible = this.getJobs().filter((j) => this.isEligible(j, now));
      for (let i = 0; i < capacity && i < eligible.length; i++) {
        void this.runJob(eligible[i]);
      }
    }

    // ¿Queda trabajo pendiente o en curso?
    const pendingOrActive = this.getJobs().some(
      (j) => !TERMINAL.includes(j.status) && j.status !== 'ERROR',
    );

    if (pendingOrActive || this.active.size > 0) {
      // Re-evaluar pronto (para respetar nextAttemptAt de reintentos).
      this.scheduleTick(250);
    } else {
      this.running = false;
      this.emit('running', false);
      this.emit('drained');
    }
    this.emitSnapshot();
  }

  private isEligible(j: Job, now: number): boolean {
    if (this.active.has(j.id)) return false;
    if (j.status === 'PENDIENTE') return true;
    if (j.status === 'REINTENTANDO') {
      return j.nextAttemptAt == null || j.nextAttemptAt <= now;
    }
    return false;
  }

  private async runJob(job: Job): Promise<void> {
    this.active.add(job.id);
    const signal = { cancelled: false };
    this.signals.set(job.id, signal);

    this.transition(job, 'PROCESANDO', {
      progress: 0,
      attempts: job.attempts + 1,
      error: null,
      nextAttemptAt: null,
    });

    const ctx: JobContext = {
      signal,
      onProgress: (pct) => {
        const j = this.jobs.get(job.id);
        if (!j || j.status !== 'PROCESANDO') return;
        j.progress = pct;
        j.updatedAt = Date.now();
        this.emit('job', { ...j });
      },
    };

    try {
      const result = await this.processor(this.jobs.get(job.id)!, ctx);
      if (signal.cancelled) throw new Error('Cancelado');
      this.recordBytes(result.outputBytes);
      const done = this.transition(job, 'COMPLETADO', {
        progress: 100,
        outputPath: result.outputPath,
        outputBytes: result.outputBytes,
        error: null,
        nextAttemptAt: null,
      });
      this.persistence.onComplete?.(done);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const current = this.jobs.get(job.id)!;

      if (signal.cancelled || current.status === 'CANCELADO') {
        // Cancelación explícita: no cuenta como error ni reintenta.
        this.active.delete(job.id);
        this.signals.delete(job.id);
        return;
      }

      this.persistence.logError(job.id, message, current.attempts);

      if (current.attempts >= this.settings.maxAttempts) {
        // Agotados los reintentos → ERROR definitivo. La cola CONTINÚA.
        const failed = this.transition(job, 'ERROR', { error: message, nextAttemptAt: null });
        this.persistence.onFinalError?.(failed);
      } else {
        // Programar reintento con backoff exponencial. La cola CONTINÚA.
        const delay = computeBackoff(current.attempts, this.settings.backoffBaseMs);
        this.transition(job, 'REINTENTANDO', {
          error: message,
          nextAttemptAt: Date.now() + delay,
          progress: 0,
        });
      }
    } finally {
      this.active.delete(job.id);
      this.signals.delete(job.id);
      if (this.running) this.scheduleTick(0);
    }
  }

  private recordBytes(bytes: number): void {
    const now = Date.now();
    if (now - this.windowStart >= 1000) {
      this.lastSpeed = (this.bytesInWindow / (now - this.windowStart)) * 1000;
      this.windowStart = now;
      this.bytesInWindow = 0;
    }
    this.bytesInWindow += bytes;
  }

  private transition(job: Job, status: JobStatus, patch: Partial<Job>): Job {
    // Partir SIEMPRE del estado actual en el mapa, no del `job` capturado en el
    // closure (que puede estar obsoleto y perder incrementos como `attempts`).
    const base = this.jobs.get(job.id) ?? job;
    const updated: Job = { ...base, ...patch, status, updatedAt: Date.now() };
    this.jobs.set(job.id, updated);
    this.persistence.saveJob(updated);
    this.emit('job', updated);
    return updated;
  }

  stats(): DashboardStats {
    const jobs = this.getJobs();
    const total = jobs.length;
    const completed = jobs.filter((j) => j.status === 'COMPLETADO').length;
    const processing = jobs.filter(
      (j) => j.status === 'PROCESANDO' || j.status === 'ANALIZANDO',
    ).length;
    const errors = jobs.filter((j) => j.status === 'ERROR').length;
    const pending = jobs.filter(
      (j) => j.status === 'PENDIENTE' || j.status === 'REINTENTANDO',
    ).length;
    const progressPct = total === 0 ? 0 : Math.round((completed / total) * 100);

    const remaining = pending + processing;
    const speed = this.lastSpeed;
    const avgBytes =
      jobs.reduce((s, j) => s + (j.outputBytes ?? 0), 0) / Math.max(1, completed);
    const etaSec =
      speed > 0 && remaining > 0 ? Math.round((remaining * avgBytes) / speed) : null;

    return { total, completed, processing, pending, errors, progressPct, etaSec, speedBytesPerSec: speed };
  }

  snapshot(): QueueSnapshot {
    return { jobs: this.getJobs(), stats: this.stats(), running: this.running };
  }

  private emitSnapshot(): void {
    this.emit('snapshot', this.snapshot());
  }
}
