// Arranque en desarrollo: levanta Vite (renderer) y Electron apuntando a él,
// recompilando main/preload. Recompilación simple; para HMR del renderer usa
// el servidor de Vite.
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import electronPath from 'electron';
import { createServer } from 'vite';

const common = {
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
  sourcemap: true, packages: 'external', logLevel: 'silent',
};

await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.mjs' });
await build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload/preload.mjs' });

const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
const info = server.config.server;
const url = `http://localhost:${info.port}`;
console.log(`Vite en ${url}`);

const child = spawn(String(electronPath), ['.', '--no-sandbox'], {
  stdio: 'inherit',
  env: { ...process.env, DANKO_DEV_SERVER: url },
});

child.on('close', () => { void server.close().then(() => process.exit(0)); });
