// ============================================================================
// Proceso principal de Electron: crea la ventana, inicializa servicios y
// registra los manejadores IPC. La lógica pesada vive en AppService.
// ============================================================================
import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, protocol, net } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, writeFileSync } from 'node:fs';
import { initSqlRuntime, Database } from '../database/Database.js';
import { AppService } from '../services/AppService.js';
import { killAllFfmpeg } from '../converter/ffmpeg.js';
import { sanitizeSegment } from '../utils/sanitize.js';
import { IPC } from '../types/ipc.js';
import type { AppSettings, TrackMetadataPatch } from '../types/index.js';

// Protocolo privilegiado para servir audio local al reproductor sin exponer
// file:// al renderer. Debe registrarse antes de que la app esté lista.
protocol.registerSchemesAsPrivileged([
  { scheme: 'danko-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let service: AppService;
let quitting = false;

/** Localiza el .wasm de sql.js (node_modules en dev, resources en prod). */
function locateSqlWasm(file: string): string {
  const candidates = [
    join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file),
    process.resourcesPath ? join(process.resourcesPath, 'sql-wasm', file) : '',
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  return file;
}

async function initService(): Promise<void> {
  await initSqlRuntime(locateSqlWasm);
  const userData = app.getPath('userData');
  const db = await Database.open(join(userData, 'danko.sqlite'));
  service = new AppService(db, {
    dbPath: join(userData, 'danko.sqlite'),
    workDir: join(app.getPath('temp'), 'danko-work'),
    defaultOutputDir: join(app.getPath('music'), 'DANKO Converter'),
  });

  // Reemitir eventos de la cola hacia el renderer.
  service.queue.on('snapshot', (snap) => mainWindow?.webContents.send(IPC.evtSnapshot, snap));
  service.queue.on('job', (job) => mainWindow?.webContents.send(IPC.evtJob, job));

  registerMediaProtocol();
}

/** Sirve audio local por danko-media://media/?p=<ruta>, validando existencia. */
function registerMediaProtocol(): void {
  protocol.handle('danko-media', async (request) => {
    try {
      const url = new URL(request.url);
      const p = url.searchParams.get('p');
      if (!p) return new Response('Ruta ausente', { status: 400 });
      const safe = service.getPlayablePath(p);
      if (!safe) return new Response('No encontrado', { status: 404 });
      return net.fetch(pathToFileURL(safe).toString());
    } catch {
      return new Response('Error', { status: 500 });
    }
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0e0e12',
    show: false,
    autoHideMenuBar: true,
    icon: join(__dirname, '..', 'renderer', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = process.env.DANKO_DEV_SERVER;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  }

  // Endurecimiento de seguridad: nunca abrir ventanas nuevas dentro de la app y
  // bloquear cualquier navegación fuera del origen local. Los enlaces externos
  // (p. ej. Spotify) se abren en el navegador del sistema, no dentro de Electron.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const isDev = !!devUrl && url.startsWith(devUrl);
    if (!url.startsWith('file://') && !isDev) {
      e.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });
  mainWindow.webContents.on('will-attach-webview', (e) => e.preventDefault());

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    // Modo humo: para pruebas de arranque headless. Al llegar aquí la ventana
    // está lista y el renderer ha pintado; confirmamos y salimos limpiamente.
    if (process.env.DANKO_SMOKE === '1') {
      // eslint-disable-next-line no-console
      console.log('DANKO_SMOKE_OK');
      setTimeout(() => { quitting = true; app.quit(); }, 300);
    }
  });

  mainWindow.on('close', (e) => {
    const minimizeToTray = service?.getSettings().general.minimizeToTray;
    // Solo ocultar a la bandeja si esta existe; de lo contrario no habría forma
    // de reabrir la ventana. Sin bandeja, cerrar cierra la app de verdad.
    if (!quitting && minimizeToTray && tray) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray(): void {
  try {
    // Icono opcional; si no existe, se omite la bandeja sin romper la app.
    const iconPath = join(__dirname, '..', 'renderer', 'icon.png');
    if (!existsSync(iconPath)) return;
    tray = new Tray(iconPath);
    tray.setToolTip('Danko Music Converter');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Abrir', click: () => mainWindow?.show() },
      { type: 'separator' },
      { label: 'Salir', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', () => mainWindow?.show());
  } catch {
    /* bandeja no disponible */
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.getSettings, () => service.getSettings());
  ipcMain.handle(IPC.updateSettings, (_e, patch: Partial<AppSettings>) => {
    const updated = service.updateSettings(patch);
    applyAutoLaunch(updated);
    return updated;
  });

  ipcMain.handle(IPC.importDemo, (_e, n?: number) => service.importDemoPlaylist(n));

  ipcMain.handle(IPC.importFiles, async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Selecciona archivos de audio',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return service.importLocalFiles(res.filePaths);
  });

  ipcMain.handle(IPC.importFolder, async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Selecciona una carpeta de audio',
      properties: ['openDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return service.importFolder(res.filePaths[0]);
  });

  ipcMain.handle(IPC.importSpotify, async (_e, url: string, localFolder?: string) => {
    let folder = localFolder;
    if (folder === undefined) {
      const res = await dialog.showOpenDialog(mainWindow!, {
        title: 'Carpeta de música local para emparejar con Spotify (Cancelar = solo metadatos)',
        properties: ['openDirectory'],
      });
      folder = res.canceled ? undefined : res.filePaths[0];
    }
    return service.importSpotifyPlaylist(url, folder);
  });

  ipcMain.handle(IPC.getPlaylists, () => service.getPlaylists());
  ipcMain.handle(IPC.getTracks, (_e, id: string) => service.getTracks(id));
  ipcMain.handle(IPC.getHistory, () => service.getHistory());
  ipcMain.handle(IPC.deleteHistory, (_e, id: string) => service.deleteHistory(id));
  ipcMain.handle(IPC.clearHistory, () => service.clearHistory());
  ipcMain.handle(IPC.getDashboard, () => service.getDashboard());

  ipcMain.handle(IPC.createPlaylist, (_e, name: string) => service.createPlaylist(name));
  ipcMain.handle(IPC.renamePlaylist, (_e, id: string, name: string) => service.renamePlaylist(id, name));
  ipcMain.handle(IPC.deletePlaylist, (_e, id: string) => service.deletePlaylist(id));
  ipcMain.handle(IPC.duplicatePlaylist, (_e, id: string) => service.duplicatePlaylist(id));
  ipcMain.handle(IPC.reorderTrack, (_e, trackId: string, dir: -1 | 1) => service.reorderTrack(trackId, dir));
  ipcMain.handle(IPC.exportPlaylist, async (_e, id: string) => {
    const content = service.exportPlaylistM3U(id);
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: 'Exportar playlist (M3U)',
      defaultPath: 'playlist.m3u',
      filters: [{ name: 'Playlist M3U', extensions: ['m3u'] }],
    });
    if (res.canceled || !res.filePath) return null;
    writeFileSync(res.filePath, content, 'utf8');
    return res.filePath;
  });
  ipcMain.handle(IPC.exportVirtualDj, async (_e, id: string) => {
    const result = service.prepareVirtualDjExport(id);
    const playlist = service.getPlaylists().find(p => p.id === id)!;
    const nativeFolder = process.platform === 'win32' && process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'VirtualDJ', 'MyLists') : join(app.getPath('documents'), 'VirtualDJ', 'MyLists');
    const destination = existsSync(nativeFolder) ? nativeFolder : app.getPath('documents');
    const saved = await dialog.showSaveDialog(mainWindow!, {
      title: `Exportar a VirtualDJ: ${result.exported} pistas, ${result.omitted.length} omitidas`,
      defaultPath: join(destination, `${sanitizeSegment(playlist.name)} - Danko.vdjfolder`),
      filters: [{ name: 'Lista nativa de VirtualDJ', extensions: ['vdjfolder'] }],
    });
    if (saved.canceled || !saved.filePath) return null;
    if (!saved.filePath.toLowerCase().endsWith('.vdjfolder')) throw new Error('El destino debe terminar en .vdjfolder');
    // Exclusive creation prevents replacing an existing playlist or source file.
    writeFileSync(saved.filePath, result.content, { encoding: 'utf8', flag: 'wx' });
    return { path: saved.filePath, exported: result.exported, omitted: result.omitted };
  });

  ipcMain.handle(IPC.updateTrackMetadata, (_e, trackId: string, patch: TrackMetadataPatch) =>
    service.updateTrackMetadata(trackId, patch));
  ipcMain.handle(IPC.removeTrack, (_e, trackId: string) => service.removeTrack(trackId));
  ipcMain.handle(IPC.getLibrary, () => service.getLibrary());
  ipcMain.handle(IPC.getPlayablePath, (_e, path: string) => service.getPlayablePath(path));

  ipcMain.handle(IPC.enqueue, (_e, id: string) => service.enqueuePlaylist(id));
  ipcMain.handle(IPC.enqueueTrack, (_e, id: string) => service.enqueueTrack(id));
  ipcMain.handle(IPC.cancelAll, () => service.cancelAll());
  ipcMain.handle(IPC.retryFailed, () => service.retryFailed());
  ipcMain.handle(IPC.clearCompleted, () => service.clearCompleted());
  ipcMain.handle(IPC.clearFailed, () => service.clearFailed());
  ipcMain.handle(IPC.removeJob, (_e, id: string) => service.removeJob(id));
  ipcMain.handle(IPC.reorderJob, (_e, id: string, dir: -1 | 1) => service.reorderJob(id, dir));
  ipcMain.handle(IPC.matchPlaylist, (_e, id: string) => service.matchPlaylistToLibrary(id));
  ipcMain.handle(IPC.acceptMatch, (_e, trackId: string, path: string) => service.acceptMatch(trackId, path));
  ipcMain.handle(IPC.startQueue, () => service.startQueue());
  ipcMain.handle(IPC.pauseQueue, () => service.pauseQueue());
  ipcMain.handle(IPC.retryJob, (_e, id: string) => service.retryJob(id));
  ipcMain.handle(IPC.cancelJob, (_e, id: string) => service.cancelJob(id));
  ipcMain.handle(IPC.getSnapshot, () => service.queue.snapshot());

  ipcMain.handle(IPC.getInterrupted, () => service.getInterruptedQueue());
  ipcMain.handle(IPC.resumeInterrupted, () => service.resumeInterruptedQueue());
  ipcMain.handle(IPC.discardInterrupted, () => service.discardInterruptedQueue());

  ipcMain.handle(IPC.chooseOutputDir, async () => {
    const res = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });
  ipcMain.handle(IPC.openPath, async (_e, path: string) => {
    if (path) await shell.openPath(path);
  });
}

function applyAutoLaunch(settings: AppSettings): void {
  try {
    app.setLoginItemSettings({ openAtLogin: settings.general.startWithWindows });
  } catch {
    /* no soportado en esta plataforma */
  }
}

// Instancia única: evita colas duplicadas sobre la misma BD.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    await initService();
    registerIpc();
    createWindow();
    createTray();
    applyAutoLaunch(service.getSettings());

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('before-quit', () => {
  quitting = true;
  // Cierre ordenado: pausar la cola, matar procesos FFmpeg huérfanos y persistir.
  try {
    service?.pauseQueue();
    killAllFfmpeg();
    service?.close();
  } catch {
    /* noop */
  }
});

app.on('window-all-closed', () => {
  // En macOS las apps siguen vivas sin ventanas. En Windows/Linux solo
  // seguimos vivos si hay bandeja activa y el usuario eligió minimizar a ella.
  const keepAlive = service?.getSettings().general.minimizeToTray && tray;
  if (process.platform !== 'darwin' && !keepAlive) {
    app.quit();
  }
});
