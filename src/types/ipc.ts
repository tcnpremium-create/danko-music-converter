// ============================================================================
// Contrato IPC entre el proceso principal y el renderer (expuesto vía preload).
// ============================================================================
import type {
  AppSettings, Playlist, Track, Job, HistoryEntry, QueueSnapshot,
  InterruptedQueueInfo, LibraryItem, TrackMetadataPatch, MatchRow, DashboardSummary,
} from './index.js';

export interface DankoApi {
  // Ajustes
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;

  // Importación
  importDemo(trackCount?: number): Promise<{ playlist: Playlist; tracks: Track[] }>;
  importFiles(): Promise<{ playlist: Playlist; tracks: Track[] } | null>;
  importFolder(): Promise<{ playlist: Playlist; tracks: Track[] } | null>;
  importSpotify(url: string, localFolder?: string): Promise<{ playlist: Playlist; tracks: Track[]; matched: number }>;

  // Consultas
  getPlaylists(): Promise<Playlist[]>;
  getTracks(playlistId: string): Promise<Track[]>;
  getHistory(): Promise<HistoryEntry[]>;
  deleteHistory(id: string): Promise<void>;
  clearHistory(): Promise<void>;
  getDashboard(): Promise<DashboardSummary>;

  // Playlist CRUD
  createPlaylist(name: string): Promise<Playlist>;
  renamePlaylist(id: string, name: string): Promise<Playlist | null>;
  deletePlaylist(id: string): Promise<void>;
  duplicatePlaylist(id: string): Promise<Playlist | null>;
  reorderTrack(trackId: string, dir: -1 | 1): Promise<void>;
  /** Exporta a M3U mediante diálogo de guardado; devuelve la ruta o null. */
  exportPlaylist(id: string): Promise<string | null>;

  // Pistas / biblioteca
  updateTrackMetadata(trackId: string, patch: TrackMetadataPatch): Promise<Track | null>;
  removeTrack(trackId: string): Promise<void>;
  getLibrary(): Promise<LibraryItem[]>;
  getPlayablePath(path: string): Promise<string | null>;
  /** Construye una URL reproducible por <audio> a partir de una ruta local. */
  mediaUrl(path: string): string;

  // Cola
  enqueue(playlistId: string): Promise<Job[]>;
  enqueueTrack(trackId: string): Promise<Job | null>;
  startQueue(): Promise<void>;
  pauseQueue(): Promise<void>;
  retryJob(id: string): Promise<void>;
  cancelJob(id: string): Promise<void>;
  cancelAll(): Promise<void>;
  retryFailed(): Promise<number>;
  clearCompleted(): Promise<number>;
  clearFailed(): Promise<number>;
  removeJob(id: string): Promise<void>;
  reorderJob(id: string, dir: -1 | 1): Promise<void>;
  getSnapshot(): Promise<QueueSnapshot>;

  // Matching Spotify → biblioteca
  matchPlaylist(playlistId: string): Promise<MatchRow[]>;
  acceptMatch(trackId: string, candidatePath: string): Promise<Track | null>;

  // Recuperación
  getInterrupted(): Promise<InterruptedQueueInfo | null>;
  resumeInterrupted(): Promise<Job[]>;
  discardInterrupted(): Promise<void>;

  // Utilidades del SO
  chooseOutputDir(): Promise<string | null>;
  openPath(path: string): Promise<void>;

  // Eventos push (main → renderer)
  onSnapshot(cb: (snap: QueueSnapshot) => void): () => void;
  onJob(cb: (job: Job) => void): () => void;
}

export const IPC = {
  getSettings: 'getSettings',
  updateSettings: 'updateSettings',
  importDemo: 'importDemo',
  importFiles: 'importFiles',
  importFolder: 'importFolder',
  importSpotify: 'importSpotify',
  getPlaylists: 'getPlaylists',
  getTracks: 'getTracks',
  getHistory: 'getHistory',
  deleteHistory: 'deleteHistory',
  clearHistory: 'clearHistory',
  getDashboard: 'getDashboard',
  createPlaylist: 'createPlaylist',
  renamePlaylist: 'renamePlaylist',
  deletePlaylist: 'deletePlaylist',
  duplicatePlaylist: 'duplicatePlaylist',
  reorderTrack: 'reorderTrack',
  exportPlaylist: 'exportPlaylist',
  updateTrackMetadata: 'updateTrackMetadata',
  removeTrack: 'removeTrack',
  getLibrary: 'getLibrary',
  getPlayablePath: 'getPlayablePath',
  enqueue: 'enqueue',
  enqueueTrack: 'enqueueTrack',
  cancelAll: 'cancelAll',
  retryFailed: 'retryFailed',
  clearCompleted: 'clearCompleted',
  clearFailed: 'clearFailed',
  removeJob: 'removeJob',
  reorderJob: 'reorderJob',
  matchPlaylist: 'matchPlaylist',
  acceptMatch: 'acceptMatch',
  startQueue: 'startQueue',
  pauseQueue: 'pauseQueue',
  retryJob: 'retryJob',
  cancelJob: 'cancelJob',
  getSnapshot: 'getSnapshot',
  getInterrupted: 'getInterrupted',
  resumeInterrupted: 'resumeInterrupted',
  discardInterrupted: 'discardInterrupted',
  chooseOutputDir: 'chooseOutputDir',
  openPath: 'openPath',
  evtSnapshot: 'evt:snapshot',
  evtJob: 'evt:job',
} as const;

declare global {
  interface Window {
    danko: DankoApi;
  }
}
