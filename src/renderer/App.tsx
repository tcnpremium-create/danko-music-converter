import { useState, useEffect } from 'react';
import { useStore } from './store.js';
import { HomePage, DownloadsPage } from '../pages/Misc.js';
import { LibraryPage } from '../pages/Library.js';
import { PlaylistsPage } from '../pages/Playlists.js';
import { PlaylistDetailPage } from '../pages/PlaylistDetail.js';
import { QueuePage } from '../pages/Queue.js';
import { DemoPage } from '../pages/Demo.js';
import { HistoryPage } from '../pages/History.js';
import { SettingsPage } from '../pages/Settings.js';
import { Player } from '../components/Player.js';
import type { Playlist } from '../types/index.js';

type Route = 'home' | 'library' | 'playlists' | 'downloads' | 'queue' | 'history' | 'demo' | 'settings';

const NAV: { id: Route; ico: string; label: string }[] = [
  { id: 'home', ico: '🏠', label: 'Inicio' },
  { id: 'library', ico: '🎵', label: 'Biblioteca' },
  { id: 'playlists', ico: '📋', label: 'Playlists' },
  { id: 'downloads', ico: '⬇', label: 'Descargas' },
  { id: 'queue', ico: '⏳', label: 'Cola' },
  { id: 'history', ico: '📜', label: 'Historial' },
  { id: 'demo', ico: '🧪', label: 'Demo' },
  { id: 'settings', ico: '⚙', label: 'Configuración' },
];

function RecoveryModal() {
  const { interrupted, dismissInterrupted, api } = useStore();
  if (!interrupted) return null;
  return (
    <div className="overlay">
      <div className="modal">
        <h2>Se ha encontrado una cola interrumpida</h2>
        <p className="page-sub">{interrupted.playlistName}</p>
        <div className="grid cards" style={{ marginBottom: 18 }}>
          <div className="card stat"><div className="k">Total</div><div className="v">{interrupted.total}</div></div>
          <div className="card stat ok"><div className="k">Completadas</div><div className="v">{interrupted.completed}</div></div>
          <div className="card stat info"><div className="k">En proceso</div><div className="v">{interrupted.processing}</div></div>
          <div className="card stat warn"><div className="k">Pendientes</div><div className="v">{interrupted.pending}</div></div>
        </div>
        <div className="row">
          <button className="btn primary" onClick={async () => { await api.resumeInterrupted(); await api.startQueue(); dismissInterrupted(); }}>Continuar</button>
          <button className="btn ghost" onClick={async () => { await api.discardInterrupted(); dismissInterrupted(); }}>Reiniciar</button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const { settings, snapshot, nowPlaying } = useStore();
  const [route, setRoute] = useState<Route>('home');
  const [openPlaylist, setOpenPlaylist] = useState<Playlist | null>(null);

  useEffect(() => {
    if (settings?.general.theme) document.documentElement.setAttribute('data-theme', settings.general.theme);
  }, [settings?.general.theme]);

  const go = (p: string) => setRoute(p as Route);
  const openDetail = (p: Playlist) => { setOpenPlaylist(p); setRoute('playlists'); };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">D</div>
          <div className="name">DANKO<small>Music Converter</small></div>
        </div>
        {NAV.map((n) => (
          <div key={n.id} className={`navlink ${route === n.id ? 'active' : ''}`}
            onClick={() => { if (n.id === 'playlists') setOpenPlaylist(null); setRoute(n.id); }}>
            <span className="ico">{n.ico}</span>
            <span>{n.label}</span>
            {n.id === 'queue' && snapshot.stats.processing + snapshot.stats.pending > 0 && (
              <span className="pill" style={{ marginLeft: 'auto' }}>{snapshot.stats.processing + snapshot.stats.pending}</span>
            )}
          </div>
        ))}
        <div className="spacer" />
        <div className="footnote">Solo fuentes locales, autorizadas o demo.<br />Sin DRM ni contenido protegido.</div>
      </aside>

      <main className="main" style={{ paddingBottom: nowPlaying ? 92 : undefined }}>
        {route === 'home' && <HomePage go={go} />}
        {route === 'library' && <LibraryPage />}
        {route === 'playlists' && (openPlaylist
          ? <PlaylistDetailPage playlist={openPlaylist} onBack={() => setOpenPlaylist(null)} onGoQueue={() => setRoute('queue')} />
          : <PlaylistsPage onGoQueue={() => setRoute('queue')} onOpen={openDetail} />)}
        {route === 'downloads' && <DownloadsPage />}
        {route === 'queue' && <QueuePage />}
        {route === 'history' && <HistoryPage />}
        {route === 'demo' && <DemoPage onGoQueue={() => setRoute('queue')} />}
        {route === 'settings' && <SettingsPage />}
      </main>

      <RecoveryModal />
      <Player />
    </div>
  );
}
