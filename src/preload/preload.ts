// ============================================================================
// Preload: expone una API segura y tipada al renderer mediante contextBridge.
// No se expone ipcRenderer directo; solo funciones concretas.
// ============================================================================
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../types/ipc.js';
import type { DankoApi } from '../types/ipc.js';
import type { QueueSnapshot, Job } from '../types/index.js';

const api: DankoApi = {
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),

  importDemo: (trackCount) => ipcRenderer.invoke(IPC.importDemo, trackCount),
  importFiles: () => ipcRenderer.invoke(IPC.importFiles),
  importFolder: () => ipcRenderer.invoke(IPC.importFolder),
  importSpotify: (url, localFolder) => ipcRenderer.invoke(IPC.importSpotify, url, localFolder),

  getPlaylists: () => ipcRenderer.invoke(IPC.getPlaylists),
  getTracks: (id) => ipcRenderer.invoke(IPC.getTracks, id),
  getHistory: () => ipcRenderer.invoke(IPC.getHistory),
  deleteHistory: (id) => ipcRenderer.invoke(IPC.deleteHistory, id),
  clearHistory: () => ipcRenderer.invoke(IPC.clearHistory),
  getDashboard: () => ipcRenderer.invoke(IPC.getDashboard),
  createPlaylist: (name) => ipcRenderer.invoke(IPC.createPlaylist, name),
  renamePlaylist: (id, name) => ipcRenderer.invoke(IPC.renamePlaylist, id, name),
  deletePlaylist: (id) => ipcRenderer.invoke(IPC.deletePlaylist, id),
  duplicatePlaylist: (id) => ipcRenderer.invoke(IPC.duplicatePlaylist, id),
  reorderTrack: (trackId, dir) => ipcRenderer.invoke(IPC.reorderTrack, trackId, dir),
  exportPlaylist: (id) => ipcRenderer.invoke(IPC.exportPlaylist, id),
  exportVirtualDj: (id) => ipcRenderer.invoke(IPC.exportVirtualDj, id),

  updateTrackMetadata: (trackId, patch) => ipcRenderer.invoke(IPC.updateTrackMetadata, trackId, patch),
  removeTrack: (trackId) => ipcRenderer.invoke(IPC.removeTrack, trackId),
  getLibrary: () => ipcRenderer.invoke(IPC.getLibrary),
  getPlayablePath: (path) => ipcRenderer.invoke(IPC.getPlayablePath, path),
  mediaUrl: (path) => `danko-media://media/?p=${encodeURIComponent(path)}`,

  enqueue: (playlistId) => ipcRenderer.invoke(IPC.enqueue, playlistId),
  enqueueTrack: (trackId) => ipcRenderer.invoke(IPC.enqueueTrack, trackId),
  cancelAll: () => ipcRenderer.invoke(IPC.cancelAll),
  retryFailed: () => ipcRenderer.invoke(IPC.retryFailed),
  clearCompleted: () => ipcRenderer.invoke(IPC.clearCompleted),
  clearFailed: () => ipcRenderer.invoke(IPC.clearFailed),
  removeJob: (id) => ipcRenderer.invoke(IPC.removeJob, id),
  reorderJob: (id, dir) => ipcRenderer.invoke(IPC.reorderJob, id, dir),
  matchPlaylist: (playlistId) => ipcRenderer.invoke(IPC.matchPlaylist, playlistId),
  acceptMatch: (trackId, candidatePath) => ipcRenderer.invoke(IPC.acceptMatch, trackId, candidatePath),
  startQueue: () => ipcRenderer.invoke(IPC.startQueue),
  pauseQueue: () => ipcRenderer.invoke(IPC.pauseQueue),
  retryJob: (id) => ipcRenderer.invoke(IPC.retryJob, id),
  cancelJob: (id) => ipcRenderer.invoke(IPC.cancelJob, id),
  getSnapshot: () => ipcRenderer.invoke(IPC.getSnapshot),

  getInterrupted: () => ipcRenderer.invoke(IPC.getInterrupted),
  resumeInterrupted: () => ipcRenderer.invoke(IPC.resumeInterrupted),
  discardInterrupted: () => ipcRenderer.invoke(IPC.discardInterrupted),

  chooseOutputDir: () => ipcRenderer.invoke(IPC.chooseOutputDir),
  openPath: (path) => ipcRenderer.invoke(IPC.openPath, path),

  onSnapshot: (cb: (snap: QueueSnapshot) => void) => {
    const listener = (_e: unknown, snap: QueueSnapshot) => cb(snap);
    ipcRenderer.on(IPC.evtSnapshot, listener);
    return () => ipcRenderer.removeListener(IPC.evtSnapshot, listener);
  },
  onJob: (cb: (job: Job) => void) => {
    const listener = (_e: unknown, job: Job) => cb(job);
    ipcRenderer.on(IPC.evtJob, listener);
    return () => ipcRenderer.removeListener(IPC.evtJob, listener);
  },
};

contextBridge.exposeInMainWorld('danko', api);
