# Instalación

## Usuario final (Windows 10/11)

1. Descarga `Danko Music Converter-1.0.0-Setup.exe`.
2. Ejecuta el instalador. Puedes elegir la carpeta de instalación.
3. Se crean accesos directos en el escritorio y el menú de inicio.
4. Para desinstalar: *Configuración de Windows → Aplicaciones*, o el
   desinstalador incluido.

FFmpeg va incluido en la aplicación; no requiere instalación aparte.

## Construir el instalador

Requisitos: Node.js 20+. Para generar el `.exe` desde Linux/macOS se necesita
`wine`; en Windows no hace falta.

```bash
npm install
npm run build                # main + preload + renderer
npm run fetch:ffmpeg-win     # descarga ffmpeg.exe para Windows a resources/ffmpeg
npm run dist:win             # genera release/Danko Music Converter-1.0.0-Setup.exe
```

El binario de Windows de FFmpeg se descarga con `fetch:ffmpeg-win` porque
`ffmpeg-static` instala el de la plataforma de build. Si no hay red, coloca
manualmente un `ffmpeg.exe` en `resources/ffmpeg/ffmpeg.exe`.

## Validación sin instalador

```bash
npm run dist:dir     # app desempaquetada en release/ (sin NSIS)
```

## Build automático en GitHub Actions (recomendado)

El repositorio incluye `.github/workflows/build-windows.yml`, que compila el
instalador en un runner **Windows** (sin depender de Linux/wine):

- **push a `main` / PR**: ejecuta typecheck + tests + build + `electron-builder`
  y sube el `.exe` como *artifact* descargable desde la pestaña Actions.
- **push de un tag `vX.Y.Z`**: además publica el `.exe` en una **GitHub Release**.

Para publicar la versión 1.0.0:

```bash
git tag v1.0.0
git push origin v1.0.0
```

El workflow no necesita secretos adicionales (usa el `GITHUB_TOKEN` integrado).

## Alojamiento y distribución

La aplicación es una app de escritorio: **no se aloja en un servidor**, se
distribuye como archivo instalador que el usuario descarga y ejecuta. El
resultado de `npm run dist:win` es un único fichero:

```
release/Danko Music Converter-1.0.0-Setup.exe
```

Opciones para hacérselo llegar al cliente (de más a menos recomendada):

1. **GitHub Releases** (recomendado): sube el `.exe` como *asset* de una release
   con etiqueta de versión (`v1.0.0`). Da URL directa de descarga y permite
   habilitar **auto-actualización** más adelante con `electron-updater` (la
   config ya escribe `app-update.yml`).
2. **Almacenamiento en la nube / CDN**: cualquier hosting de archivos con enlace
   directo (S3, Cloudflare R2, Google Drive, un bucket propio). Basta con servir
   el `.exe`.
3. **Entrega directa**: enviar el `.exe` por transferencia de archivos.

Recomendaciones de producción:

- **Firma de código (code signing)**: sin firmar, Windows SmartScreen mostrará
  un aviso al abrir el instalador. Para evitarlo se necesita un certificado de
  firma; se configura en `electron-builder.yml` (`win.certificateFile` /
  variables de entorno). No es obligatorio para funcionar, sí para una
  experiencia sin advertencias.
- **CI**: lo ideal es construir el instalador en un runner de Windows (GitHub
  Actions `windows-latest`) para no depender de `wine`.

## Cómo se abre la aplicación

- **Tras instalar**: se abre desde el **acceso directo del escritorio** o desde
  el **menú de inicio** (“Danko Music Converter”). Es una ventana de
  escritorio normal, no un navegador ni una web.
- Al cerrar la ventana, si “Minimizar a la bandeja” está activo, la app queda en
  el **área de notificación** (icono junto al reloj); se reabre con clic en ese
  icono o se sale desde su menú.
- **Sin instalar** (validación): ejecuta el binario de `release/…-unpacked/`, o
  en desarrollo `npm run dev`.
