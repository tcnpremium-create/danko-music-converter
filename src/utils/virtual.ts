// ============================================================================
// Ventana de virtualización para listas largas (biblioteca, cola, historial,
// playlists). Cálculo puro → testeable; el componente React lo usa para
// renderizar solo las filas visibles + un margen (overscan).
// ============================================================================

export interface VirtualWindow {
  startIndex: number;
  endIndex: number; // exclusivo
  offsetY: number; // padding superior en px para posicionar las filas visibles
  totalHeight: number; // alto total del contenido en px
}

/**
 * Calcula qué filas renderizar dado el scroll actual.
 * @param scrollTop   desplazamiento vertical del contenedor (px)
 * @param rowHeight   alto de cada fila (px)
 * @param viewportH   alto visible del contenedor (px)
 * @param total       número total de filas
 * @param overscan    filas extra por encima/debajo para scroll suave
 */
export function computeWindow(
  scrollTop: number,
  rowHeight: number,
  viewportH: number,
  total: number,
  overscan = 6,
): VirtualWindow {
  const safeRow = Math.max(1, rowHeight);
  const totalHeight = total * safeRow;
  if (total === 0) return { startIndex: 0, endIndex: 0, offsetY: 0, totalHeight: 0 };

  const first = Math.floor(Math.max(0, scrollTop) / safeRow);
  const visibleCount = Math.ceil(Math.max(0, viewportH) / safeRow);
  const startIndex = Math.max(0, first - overscan);
  const endIndex = Math.min(total, first + visibleCount + overscan);
  return { startIndex, endIndex, offsetY: startIndex * safeRow, totalHeight };
}
