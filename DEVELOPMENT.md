# Desarrollo

## Requisitos
- Node.js 20+.
- FFmpeg: en desarrollo se usa `ffmpeg-static` automáticamente.

## Scripts

| Script                | Descripción                                            |
|-----------------------|--------------------------------------------------------|
| `npm run dev`         | Vite (renderer) + Electron con recarga.                |
| `npm run build`       | Compila main, preload y renderer.                      |
| `npm test`            | Tests unitarios e integración (Vitest, FFmpeg real).   |
| `npm run e2e`         | Arranque real de Electron (headless con xvfb en Linux).|
| `npm run typecheck`   | Comprobación de tipos.                                  |
| `npm run dist:win`    | Instalador NSIS de Windows.                            |

## Estructura

Ver `ARCHITECTURE.md`. Reglas: separar responsabilidades por módulo, sin
archivos gigantes, lógica de negocio (cola, conversión, BD) desacoplada de
Electron para poder testearla de forma aislada.

## Compilación de main/preload

`esbuild` con `packages: 'external'`: solo se empaqueta `src/`; las
dependencias de node_modules se cargan en tiempo de ejecución (evita romper
módulos CJS que hacen `require()` dinámico de built-ins). Salida ESM `.mjs`.

## Pruebas clave

- `queue.test.ts` — jobs independientes, backoff, **prueba especial de la
  canción 47**, ERROR tras agotar reintentos, reintento manual.
- `database.test.ts` — migraciones, persistencia, duplicados, recuperación.
- `converter.test.ts` — conversión real WAV→MP3/FLAC, progreso, cancelación.
- `e2e.test.ts` — pipeline completo `AppService` con FFmpeg real: fallo
  forzado, continuidad de la cola, recuperación y política de duplicados.

## Añadir un proveedor

Implementa `SourceProvider` (`providers/types.ts`) y regístralo en
`ProviderRegistry`. `prepareInput` debe devolver la ruta a un archivo local
real y autorizado; nunca contenido protegido.
