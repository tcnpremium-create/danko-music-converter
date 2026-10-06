import { useState } from 'react';
import { useStore, fmtDuration, fmtBytes } from '../renderer/store.js';
import { Cover } from '../components/Cover.js';
import type { Playlist } from '../types/index.js';

export function PlaylistsPage({ onGoQueue, onOpen }: { onGoQueue: () => void; onOpen: (p: Playlist) => void }) {
  const { playlists, refreshPlaylists, api, settings } = useStore();
  const [busy, setBusy] = useState(false);

  const importDemo = async () => {
    setBusy(true);
    try {
      await api.importDemo(settings?.demo.trackCount);
      await refreshPlaylists();
    } finally { setBusy(false); }
  };
  const importFiles = async () => {
    setBusy(true);
    try { if (await api.importFiles()) await refreshPlaylists(); }
    finally { setBusy(false); }
  };
  const importSpotify = async () => {
    const url = window.prompt('Pega la URL de la playlist de Spotify:');
    if (!url) return;
    setBusy(true);
    try {
      await api.importSpotify(url.trim());
      await refreshPlaylists();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const importFolder = async () => {
    setBusy(true);
    try { if (await api.importFolder()) await refreshPlaylists(); }
    finally { setBusy(false); }
  };

  const enqueue = async (p: Playlist) => {
    await api.enqueue(p.id);
    await api.startQueue();
    onGoQueue();
  };

  const createPlaylist = async () => {
    const name = window.prompt('Nombre de la nueva playlist:', 'Nueva playlist');
    if (name === null) return;
    setBusy(true);
    try { await api.createPlaylist(name); await refreshPlaylists(); }
    finally { setBusy(false); }
  };
  const rename = async (p: Playlist) => {
    const name = window.prompt('Nuevo nombre:', p.name);
    if (name === null || name.trim() === '' || name === p.name) return;
    setBusy(true);
    try { await api.renamePlaylist(p.id, name); await refreshPlaylists(); }
    finally { setBusy(false); }
  };
  const duplicate = async (p: Playlist) => {
    setBusy(true);
    try { await api.duplicatePlaylist(p.id); await refreshPlaylists(); }
    finally { setBusy(false); }
  };
  const remove = async (p: Playlist) => {
    if (!window.confirm(`¿Eliminar la playlist "${p.name}"? Esto no borra tus archivos de audio.`)) return;
    setBusy(true);
    try { await api.deletePlaylist(p.id); await refreshPlaylists(); }
    finally { setBusy(false); }
  };
  const exportM3U = async (p: Playlist) => {
    const path = await api.exportPlaylist(p.id);
    if (path) window.alert(`Playlist exportada:\n${path}`);
  };
  const exportVirtualDj = async (p: Playlist) => {
    setBusy(true);
    try {
      const result = await api.exportVirtualDj(p.id);
      if (result) window.alert(`${result.exported} pistas exportadas a VirtualDJ.\n${result.path}${result.omitted.length ? '\n\nPistas omitidas:\n' + result.omitted.map(item => `${item.title}: ${item.reason}`).join('\n') : ''}\n\nLos archivos originales se conservan. La lista utiliza rutas locales de este ordenador.`);
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <h1 className="page-title">📋 Playlists</h1>
      <p className="page-sub">Importa archivos locales, carpetas, o una playlist de Spotify. Spotify aporta metadatos; el audio se empareja con archivos locales.</p>

      <div className="row" style={{ marginBottom: 22 }}>
        <button className="btn primary" disabled={busy} onClick={importDemo}>+ Playlist demo</button>
        <button className="btn" disabled={busy} onClick={importFiles}>Importar archivos…</button>
        <button className="btn" disabled={busy} onClick={importFolder}>Importar carpeta…</button>
        <button className="btn primary" disabled={busy} onClick={importSpotify}>🎵 Importar Spotify</button>
        <button className="btn ghost" disabled={busy} onClick={createPlaylist}>+ Playlist vacía</button>
      </div>

      {playlists.length === 0 ? (
        <div className="empty">Aún no hay playlists. Empieza generando una demo.</div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))' }}>
          {playlists.map((p) => (
            <div className="card pl-card" key={p.id}>
              <Cover src={p.artworkPath} seed={p.name} size={72} radius={10} />
              <div className="pl-meta" style={{ flex: 1 }}>
                <h3>{p.name}</h3>
                <div className="muted">{p.trackCount} canciones · {fmtDuration(p.totalDurationSec)}</div>
                <div className="muted">Tamaño estimado: {fmtBytes(p.estimatedBytes)}</div>
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn sm" onClick={() => onOpen(p)}>Ver</button>
                  <button className="btn sm primary" onClick={() => enqueue(p)}>Añadir a cola</button>
                  <span className="pill">{p.provider}</span>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn sm ghost" disabled={busy} onClick={() => rename(p)}>✎ Renombrar</button>
                  <button className="btn sm ghost" disabled={busy} onClick={() => duplicate(p)}>⧉ Duplicar</button>
                  <button className="btn sm ghost" disabled={busy} onClick={() => exportM3U(p)}>⬇ Exportar</button>
                  <button className="btn sm" disabled={busy} onClick={() => exportVirtualDj(p)}>Exportar a VirtualDJ</button>
                  <button className="btn sm ghost" disabled={busy} onClick={() => remove(p)}>🗑 Eliminar</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
