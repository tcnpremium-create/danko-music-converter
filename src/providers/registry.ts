// ============================================================================
// Registro de proveedores: resuelve el proveedor adecuado por id de pista.
// ============================================================================
import type { ProviderId, DemoSettings } from '../types/index.js';
import type { SourceProvider } from './types.js';
import { LocalFilesProvider } from './LocalFilesProvider.js';
import { AuthorizedProvider } from './AuthorizedProvider.js';
import { DemoProvider } from './DemoProvider.js';
import { SpotifyMetadataProvider } from './SpotifyMetadataProvider.js';

export class ProviderRegistry {
  private providers = new Map<ProviderId, SourceProvider>();

  constructor(demoSettings: () => DemoSettings) {
    this.register(new LocalFilesProvider());
    this.register(new AuthorizedProvider());
    this.register(new DemoProvider(demoSettings));
    this.register(new SpotifyMetadataProvider());
  }

  register(p: SourceProvider): void {
    this.providers.set(p.id, p);
  }

  get(id: ProviderId): SourceProvider {
    const p = this.providers.get(id);
    if (!p) throw new Error(`Proveedor desconocido: ${id}`);
    return p;
  }

  list(): SourceProvider[] {
    return [...this.providers.values()];
  }
}
