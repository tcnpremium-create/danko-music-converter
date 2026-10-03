// ============================================================================
// Proveedor de fuentes autorizadas.
//
// Solo admite fuentes que autorizan EXPLÍCITAMENTE la descarga/exportación del
// contenido (p. ej. un archivo publicado bajo licencia libre, un endpoint que
// el propio servicio ofrece para exportar el material del usuario). No elude
// ninguna protección técnica. En esta versión trata el sourcePath como un
// recurso local ya autorizado y presente en disco.
// ============================================================================
import { existsSync, statSync } from 'node:fs';
import type { Track, ProviderId } from '../types/index.js';
import type { SourceProvider, PreparedInput, PrepareContext } from './types.js';

export class AuthorizedProvider implements SourceProvider {
  readonly id: ProviderId = 'authorized';
  readonly label = 'Fuentes autorizadas';

  async prepareInput(track: Track, _ctx: PrepareContext): Promise<PreparedInput> {
    const src = track.sourcePath;
    if (!src) {
      throw new Error('La fuente autorizada no aportó una ruta de material exportable');
    }
    if (!existsSync(src)) {
      throw new Error(`Recurso autorizado no disponible localmente: ${src}`);
    }
    const st = statSync(src);
    if (st.size <= 0) throw new Error('El recurso autorizado está vacío');
    return { inputPath: src, durationSec: track.durationSec };
  }
}
