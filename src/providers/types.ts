// ============================================================================
// Sistema modular de proveedores de origen.
//
// IMPORTANTE (política del proyecto): ningún proveedor elude protecciones
// técnicas (DRM), captura streams protegidos ni convierte contenido de
// servicios que no autoricen la exportación. Los proveedores solo trabajan con
// archivos que el usuario ya posee, fuentes que autorizan explícitamente la
// descarga, o el proveedor de demostración (contenido sintético generado
// localmente).
// ============================================================================
import type { Playlist, Track, ProviderId } from '../types/index.js';

export interface ImportResult {
  playlist: Playlist;
  tracks: Track[];
}

/** Resultado de preparar el material de entrada para una conversión. */
export interface PreparedInput {
  /** Ruta local de un archivo de audio real listo para pasar a ffmpeg. */
  inputPath: string;
  /** Duración conocida (s), si el proveedor la aporta. */
  durationSec: number;
  /** Callback de limpieza para material temporal generado por el proveedor. */
  cleanup?: () => void;
}

export interface PrepareContext {
  /** Directorio de trabajo temporal para materiales generados. */
  workDir: string;
  /** Notifica progreso de la fase de preparación (0..100). */
  onProgress?: (pct: number) => void;
  /** Señal de cancelación cooperativa. */
  signal?: { cancelled: boolean };
}

export interface SourceProvider {
  readonly id: ProviderId;
  readonly label: string;
  /**
   * Prepara la entrada de una pista: devuelve la ruta a un archivo local real.
   * Puede simular latencia o fallos (proveedor demo). Lanza si no puede
   * producir la entrada (p. ej. archivo local inexistente).
   */
  prepareInput(track: Track, ctx: PrepareContext): Promise<PreparedInput>;
}
