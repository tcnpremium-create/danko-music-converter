import { existsSync, statSync } from 'node:fs';
import type { Track, ProviderId } from '../types/index.js';
import type { SourceProvider, PreparedInput, PrepareContext } from './types.js';

export class SpotifyMetadataProvider implements SourceProvider {
  readonly id: ProviderId = 'spotify';
  readonly label = 'Spotify (metadatos + audio local)';

  async prepareInput(track: Track, _ctx: PrepareContext): Promise<PreparedInput> {
    const src = track.sourcePath;
    if (!src || !existsSync(src)) {
      throw new Error('Esta pista de Spotify no tiene un archivo local emparejado. Spotify solo aporta metadatos; el audio debe existir localmente.');
    }
    const size = statSync(src).size;
    if (size <= 0) throw new Error('El archivo local emparejado está vacío.');
    return { inputPath: src, durationSec: track.durationSec };
  }
}
