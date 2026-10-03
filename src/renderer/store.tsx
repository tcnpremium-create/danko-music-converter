// ============================================================================
// Estado global del renderer: envuelve window.danko y mantiene el snapshot vivo
// de la cola mediante los eventos push del proceso principal.
// ============================================================================
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type {
  AppSettings, Playlist, QueueSnapshot, HistoryEntry, InterruptedQueueInfo, LibraryItem,
  DashboardSummary,
} from '../types/index.js';

export interface NowPlaying {
  title: string;
  artist: string;
  path: string;
}

interface Store {
  settings: AppSettings | null;
  playlists: Playlist[];
  snapshot: QueueSnapshot;
  history: HistoryEntry[];
  library: LibraryItem[];
  dashboard: DashboardSummary | null;
  interrupted: InterruptedQueueInfo | null;
  nowPlaying: NowPlaying | null;
  setNowPlaying: (n: NowPlaying | null) => void;
  refreshPlaylists: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  refreshLibrary: () => Promise<void>;
  refreshDashboard: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
  dismissInterrupted: () => void;
  api: Window['danko'];
}

const EMPTY_SNAPSHOT: QueueSnapshot = {
  jobs: [],
  stats: { total: 0, completed: 0, processing: 0, pending: 0, errors: 0, progressPct: 0, etaSec: null, speedBytesPerSec: 0 },
  running: false,
};

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const api = window.danko;
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [snapshot, setSnapshot] = useState<QueueSnapshot>(EMPTY_SNAPSHOT);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [interrupted, setInterrupted] = useState<InterruptedQueueInfo | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);

  const refreshPlaylists = useCallback(async () => setPlaylists(await api.getPlaylists()), [api]);
  const refreshHistory = useCallback(async () => setHistory(await api.getHistory()), [api]);
  const refreshLibrary = useCallback(async () => setLibrary(await api.getLibrary()), [api]);
  const refreshDashboard = useCallback(async () => setDashboard(await api.getDashboard()), [api]);
  const refreshSettings = useCallback(async () => setSettings(await api.getSettings()), [api]);

  const saveSettings = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings(await api.updateSettings(patch));
  }, [api]);

  const dismissInterrupted = useCallback(() => setInterrupted(null), []);

  useEffect(() => {
    void refreshSettings();
    void refreshPlaylists();
    void refreshHistory();
    void refreshLibrary();
    void refreshDashboard();
    void api.getSnapshot().then(setSnapshot);
    void api.getInterrupted().then(setInterrupted);

    const offSnap = api.onSnapshot((snap) => setSnapshot(snap));
    // Los eventos por-job ya vienen incluidos en el snapshot; refrescamos historial
    // y biblioteca cuando un job completa/falla para reflejar los archivos.
    const offJob = api.onJob((job) => {
      if (job.status === 'COMPLETADO' || job.status === 'ERROR') {
        void refreshHistory();
        void refreshLibrary();
        void refreshDashboard();
      }
    });
    return () => { offSnap(); offJob(); };
  }, [api, refreshSettings, refreshPlaylists, refreshHistory, refreshLibrary, refreshDashboard]);

  const value: Store = {
    settings, playlists, snapshot, history, library, dashboard, interrupted, nowPlaying, setNowPlaying,
    refreshPlaylists, refreshHistory, refreshLibrary, refreshDashboard, refreshSettings, saveSettings, dismissInterrupted, api,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore fuera de StoreProvider');
  return s;
}

// -- Formateo ---------------------------------------------------------------

export function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m}:${String(s).padStart(2, '0')}`;
  return `0:${String(s).padStart(2, '0')}`;
}

export function fmtBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function fmtEta(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  return `${m} min`;
}
