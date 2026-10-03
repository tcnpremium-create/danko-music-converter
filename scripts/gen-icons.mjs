// Genera los iconos de la app a partir de build/icon.svg:
//  - build/icon.png  (512×512, usado por electron-builder en Linux)
//  - build/icon.ico  (multi-tamaño, usado por el instalador NSIS de Windows)
//  - src/public/icon.png (256×256, para la bandeja del sistema en el renderer)
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const svg = readFileSync('build/icon.svg');

function render(size) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  return r.render().asPng();
}

mkdirSync('build', { recursive: true });
mkdirSync('src/public', { recursive: true });

// PNG principal (512) para electron-builder / Linux.
writeFileSync('build/icon.png', render(512));

// PNG de bandeja (256) accesible por el renderer empaquetado.
writeFileSync('src/public/icon.png', render(256));

// ICO multi-tamaño para Windows (16..256).
const sizes = [16, 24, 32, 48, 64, 128, 256];
const buffers = sizes.map((s) => render(s));
const ico = await pngToIco(buffers);
writeFileSync('build/icon.ico', ico);

console.log('✓ Iconos generados: build/icon.png, build/icon.ico, src/public/icon.png');
