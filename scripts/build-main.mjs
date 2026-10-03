// Compila el proceso principal y el preload con esbuild (formato ESM).
//
// `packages: 'external'` deja TODO node_modules fuera del bundle: solo se
// empaqueta nuestro propio código src/. Así los módulos de terceros (incl. CJS
// como `debug`, que hace require() de built-ins) se cargan normalmente en
// tiempo de ejecución desde node_modules, sin reescrituras de require que
// rompan. electron-builder incluye esas dependencias en el paquete final.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('dist/main', { recursive: true });
mkdirSync('dist/preload', { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  packages: 'external',
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: ['src/main/main.ts'],
  outfile: 'dist/main/main.mjs',
});

await build({
  ...common,
  entryPoints: ['src/preload/preload.ts'],
  outfile: 'dist/preload/preload.mjs',
});

console.log('✓ main y preload compilados');
