import { describe, it, expect } from 'vitest';
import { computeWindow } from '../../utils/virtual.js';

describe('computeWindow (virtualización)', () => {
  it('lista vacía → ventana vacía', () => {
    expect(computeWindow(0, 40, 600, 0)).toEqual({ startIndex: 0, endIndex: 0, offsetY: 0, totalHeight: 0 });
  });

  it('calcula alto total y ventana inicial con overscan', () => {
    const w = computeWindow(0, 40, 600, 5000, 6);
    expect(w.totalHeight).toBe(200000);
    expect(w.startIndex).toBe(0);
    // 15 visibles + 6 overscan
    expect(w.endIndex).toBe(21);
    expect(w.offsetY).toBe(0);
  });

  it('desplazado: solo renderiza filas cercanas (no 5000)', () => {
    const w = computeWindow(40000, 40, 600, 5000, 6);
    const first = Math.floor(40000 / 40); // 1000
    expect(w.startIndex).toBe(first - 6);
    expect(w.endIndex - w.startIndex).toBeLessThan(40); // ventana pequeña
    expect(w.offsetY).toBe((first - 6) * 40);
  });

  it('no se pasa del total al final de la lista', () => {
    // Scroll al fondo real (alto total 200000, viewport 600).
    const w = computeWindow(199600, 40, 600, 5000, 6);
    expect(w.endIndex).toBe(5000);
    expect(w.startIndex).toBeLessThan(5000);
    expect(w.startIndex).toBeGreaterThan(4900);
  });
});
