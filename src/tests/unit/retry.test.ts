import { describe, it, expect } from 'vitest';
import { computeBackoff, withTimeout, TimeoutError, sleep } from '../../utils/retry.js';

describe('computeBackoff', () => {
  it('crece exponencialmente (dentro del rango de jitter)', () => {
    const base = 1000;
    // attempt 1: exp=1000 → [500,1000]; attempt 3: exp=4000 → [2000,4000]
    for (let i = 0; i < 50; i++) {
      const a1 = computeBackoff(1, base);
      const a3 = computeBackoff(3, base);
      expect(a1).toBeGreaterThanOrEqual(500);
      expect(a1).toBeLessThanOrEqual(1000);
      expect(a3).toBeGreaterThanOrEqual(2000);
      expect(a3).toBeLessThanOrEqual(4000);
    }
  });

  it('respeta el techo maxMs', () => {
    expect(computeBackoff(20, 1000, 60_000)).toBeLessThanOrEqual(60_000);
  });
});

describe('withTimeout', () => {
  it('resuelve si la promesa termina a tiempo', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('rechaza con TimeoutError y llama onTimeout', async () => {
    let cancelled = false;
    const slow = sleep(1000).then(() => 'tarde');
    await expect(
      withTimeout(slow, 50, () => { cancelled = true; }),
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(cancelled).toBe(true);
  });
});
