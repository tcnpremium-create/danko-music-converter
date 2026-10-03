// ============================================================================
// Utilidades de reintento: backoff exponencial con jitter y timeout
// ============================================================================

/**
 * Calcula el retardo (ms) antes del siguiente intento usando backoff
 * exponencial con jitter completo. `attempt` es 1-indexado (primer reintento = 1).
 *
 *   delay = base * 2^(attempt-1), acotado a maxMs, con jitter aleatorio.
 */
export function computeBackoff(
  attempt: number,
  baseMs: number,
  maxMs = 60_000,
): number {
  const exp = Math.min(baseMs * 2 ** Math.max(0, attempt - 1), maxMs);
  // Jitter completo: uniforme en [exp/2, exp] para evitar sincronización.
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operación excedió el tiempo límite de ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Envuelve una promesa con un timeout. Si se agota, rechaza con TimeoutError.
 * `onTimeout` permite cancelar el trabajo subyacente (p. ej. matar un proceso).
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        onTimeout?.();
      } finally {
        reject(new TimeoutError(ms));
      }
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));
