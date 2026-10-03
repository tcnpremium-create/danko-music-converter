// Prueba de arranque (TEST 1): compila, lanza Electron de verdad en modo humo
// bajo un display virtual y verifica que la app inicializa y carga el renderer.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import electronPath from 'electron';

if (!existsSync('dist/main/main.mjs') || !existsSync('dist/renderer/index.html')) {
  console.error('✗ Falta build. Ejecuta `npm run build` primero.');
  process.exit(1);
}

const hasXvfb = spawnSync('which', ['xvfb-run']).status === 0;
const cmd = hasXvfb ? 'xvfb-run' : String(electronPath);
const args = hasXvfb
  ? ['-a', String(electronPath), '.', '--no-sandbox']
  : ['.', '--no-sandbox'];

const child = spawn(cmd, args, {
  env: { ...process.env, DANKO_SMOKE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let ok = false;
let out = '';
const onData = (b) => {
  out += b.toString();
  if (out.includes('DANKO_SMOKE_OK')) ok = true;
};
child.stdout.on('data', onData);
child.stderr.on('data', onData);

// El primer arranque de Electron bajo xvfb puede tardar ~35 s.
const killTimer = setTimeout(() => { child.kill('SIGKILL'); }, 75000);

child.on('close', () => {
  clearTimeout(killTimer);
  if (ok) {
    console.log('✓ TEST 1: la aplicación Electron inicia y carga el renderer.');
    process.exit(0);
  } else {
    console.error('✗ La app no confirmó el arranque. Salida:\n' + out.slice(-2000));
    process.exit(1);
  }
});
