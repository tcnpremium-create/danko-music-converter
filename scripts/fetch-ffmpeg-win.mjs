// Descarga un ffmpeg.exe estático para Windows x64 y lo coloca en
// resources/ffmpeg/ffmpeg.exe para que electron-builder lo empaquete.
// Necesario porque ffmpeg-static instala el binario de la plataforma actual
// (Linux/macOS en el equipo de build), no el de Windows.
//
// Extracción multiplataforma: PowerShell (Expand-Archive) en Windows, `unzip`
// en el resto. La localización del .exe se hace recorriendo el árbol con Node
// (sin depender de `find`), de modo que funciona igual en Windows y Linux.
import { createWriteStream, existsSync, mkdirSync, statSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { get } from 'node:https';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const OUT_DIR = 'resources/ffmpeg';
const OUT = join(OUT_DIR, 'ffmpeg.exe');
const EXTRACT_DIR = join(OUT_DIR, '_extract');

// Fuente: builds estáticos de ffmpeg para Windows (gyan.dev, esencial).
const URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
const ZIP = join(OUT_DIR, 'ffmpeg-win.zip');

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error('demasiadas redirecciones')); return; }
    const file = createWriteStream(dest);
    get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        rmSync(dest, { force: true });
        download(res.headers.location, dest, redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
    }).on('error', reject);
  });
}

/** Extrae un .zip a destDir usando la herramienta nativa de la plataforma. */
function unzip(zip, destDir) {
  mkdirSync(destDir, { recursive: true });
  if (process.platform === 'win32') {
    const r = spawnSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${destDir}' -Force`,
    ], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('Expand-Archive falló');
  } else {
    const r = spawnSync('unzip', ['-o', zip, '-d', destDir], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('unzip falló (instálalo o extrae manualmente)');
  }
}

/** Busca recursivamente el primer ffmpeg.exe bajo dir (sin depender de `find`). */
function findExe(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findExe(full);
      if (hit) return hit;
    } else if (entry.name.toLowerCase() === 'ffmpeg.exe') {
      return full;
    }
  }
  return null;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(OUT) && statSync(OUT).size > 1_000_000) {
    console.log('✓ ffmpeg.exe ya presente, se omite la descarga.');
    return;
  }
  console.log('Descargando ffmpeg para Windows…');
  await download(URL, ZIP);

  console.log('Extrayendo…');
  rmSync(EXTRACT_DIR, { recursive: true, force: true });
  unzip(ZIP, EXTRACT_DIR);

  const src = findExe(EXTRACT_DIR);
  if (!src) throw new Error('ffmpeg.exe no encontrado tras la extracción');
  renameSync(src, OUT);

  // Limpieza de temporales.
  rmSync(EXTRACT_DIR, { recursive: true, force: true });
  rmSync(ZIP, { force: true });

  if (!existsSync(OUT)) throw new Error('ffmpeg.exe no quedó en su sitio');
  console.log(`✓ ffmpeg.exe listo en ${OUT} (${Math.round(statSync(OUT).size / 1e6)} MB)`);
}

main().catch((e) => {
  console.error('✗', e.message);
  console.error('Puedes colocar manualmente un ffmpeg.exe en', OUT);
  process.exit(1);
});
