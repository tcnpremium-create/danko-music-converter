// ============================================================================
// Proveedor de archivos locales: el usuario ya posee los archivos.
// ============================================================================
import { existsSync, statSync } from 'node:fs';
import type { Track, ProviderId } from '../types/index.js';
import type { SourceProvider, PreparedInput, PrepareContext } from './types.js';

export class LocalFilesProvider implements SourceProvider {
  readonly id: ProviderId = 'local';
  readonly label = 'Archivos locales';

  async prepareInput(track: Track, _ctx: PrepareContext): Promise<PreparedInput> {
    const src = track.sourcePath;
    if (!src) throw new Error('La pista no tiene ruta de origen local');
    if (!existsSync(src)) throw new Error(`Archivo de origen no encontrado: ${src}`);
    const st = statSync(src);
    if (st.size <= 0) throw new Error('El archivo de origen está vacío');
    return { inputPath: src, durationSec: track.durationSec };
  }
}
