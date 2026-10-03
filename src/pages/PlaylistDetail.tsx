import { useEffect, useState } from 'react';
import { useStore, fmtDuration, fmtBytes } from '../renderer/store.js';
import { Cover } from '../components/Cover.js';
import { ProgressBar } from '../components/common.js';
import { MetadataModal } from '../components/MetadataModal.js';
import { BulkMetadataModal } from '../components/BulkMetadataModal.js';
import { MatchReviewModal } from '../components/MatchReviewModal.js';
import type { Playlist, Track, Job } from '../types/index.js';

export function PlaylistDetailPage({
  playlist, onBack, onGoQueue,
}: { playlist: Playlist; onBack: () => void; onGoQueue: () => void }) {
  const { api, snapshot, refreshPlaylists, setNowPlaying } = useStore();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [editing, setEditing] = useState<Track | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkEditing, setBulkEditing] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = async () => setTracks(await api.getTracks(playlist.id));
  useEffect(() => { void load(); setSelected(new Set()); /* eslint-disable-next-line */ }, [playlist.id]);

  // Mapa trackId → job (para mostrar estado/progreso por canción).
  const jobByTrack = new Map<string, Job>();
  for (const j of snapshot.jobs) jobByTrack.set(j.trackId, j);

  const enqueueAll = async () => { await api.enqueue(playlist.id); await api.startQueue(); onGoQueue(); };
  // Procesa SOLO esta canción; no inicia las demás de la playlist.
  const enqueueOne = async (t: Track) => { await api.enqueueTrack(t.id); await api.startQueue(); };
  const remove = async (t: Track) => { await api.removeTrack(t.id); await load(); await refreshPlaylists(); };
  const reorder = async (t: Track, dir: -1 | 1) => { await api.reorderTrack(t.id, dir); await load(); };
  const play = (job: Job) => {
    const t = tracks.find((x) => x.id === job.trackId);
    if (job.outputPath) setNowPlaying({ title: t?.metadata.title ?? 'Pista', artist: t?.metadata.artist ?? '', path: job.outputPath });
  };
  const active = (s: Job['status']) => s === 'PROCESANDO' || s === 'PENDIENTE' || s === 'REINTENTANDO' || s === 'ANALIZANDO';

  // -- Selección múltiple y acciones en lote ---------------------------------
  const allSelected = tracks.length > 0 && selected.size === tracks.length;
  const toggleOne = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleAll = () => setSelected((s) =>
    s.size === tracks.length ? new Set() : new Set(tracks.map((t) => t.id)));
  const selectedTracks = () => tracks.filter((t) => selected.has(t.id));

  const bulkConvert = async () => {
    setBulkBusy(true);
    try {
      const ids = selectedTracks().filter((t) => t.sourcePath).map((t) => t.id);
      for (const id of ids) await api.enqueueTrack(id);
      if (ids.length > 0) { await api.startQueue(); onGoQueue(); }
    } finally { setBulkBusy(false); }
  };
  const bulkRemove = async () => {
    setBulkBusy(true);
    try {
      for (const id of Array.from(selected)) await api.removeTrack(id);
      setSelected(new Set());
      await load();
      await refreshPlaylists();
    } finally { setBulkBusy(false); }
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn sm ghost" onClick={onBack}>← Playlists</button>
      </div>

      <div className="card pl-card" style={{ marginBottom: 20 }}>
        <Cover src={playlist.artworkPath} seed={playlist.name} size={84} radius={12} />
        <div className="pl-meta" style={{ flex: 1 }}>
          <h3 style={{ fontSize: 20 }}>{playlist.name}</h3>
          <div className="muted" style={{ color: 'var(--text-dim)' }}>
            {playlist.trackCount} canciones · {fmtDuration(playlist.totalDurationSec)} · {fmtBytes(playlist.estimatedBytes)}
          </div>
          <div className="muted" style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            Importada: {new Date(playlist.createdAt).toLocaleDateString()} · fuente: {playlist.provider}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={enqueueAll}>▶ Procesar todo</button>
            <button className="btn" onClick={() => setReviewing(true)}>🔎 Revisar coincidencias</button>
            <span className="pill">{tracks.length} canciones</span>
          </div>
          {playlist.provider === 'spotify' && (
            <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
              Metadatos y portada proporcionados por Spotify. El audio se procesa únicamente desde archivos locales.
            </div>
          )}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="row bulk-bar" style={{ marginBottom: 12, alignItems: 'center' }}>
          <span className="pill">{selected.size} seleccionadas</span>
          <button className="btn sm primary" disabled={bulkBusy} onClick={bulkConvert}>▶ Convertir seleccionadas</button>
          <button className="btn sm" disabled={bulkBusy} onClick={() => setBulkEditing(true)}>✎ Editar metadatos</button>
          <button className="btn sm ghost" disabled={bulkBusy} onClick={bulkRemove}>🗑 Eliminar seleccionadas</button>
          <button className="btn sm ghost" disabled={bulkBusy} onClick={() => setSelected(new Set())}>Deseleccionar</button>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" checked={allSelected} aria-label="Seleccionar todo"
                onChange={toggleAll} /></th>
              <th className="num">#</th><th></th><th>Título</th><th>Artista</th><th>Álbum</th>
              <th className="num">Duración</th><th>Estado</th><th style={{ width: 150 }}>Progreso</th>
              <th className="num">Tamaño</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((t) => {
              const job = jobByTrack.get(t.id);
              return (
                <tr key={t.id} className={selected.has(t.id) ? 'row-selected' : undefined}>
                  <td><input type="checkbox" checked={selected.has(t.id)}
                    aria-label={`Seleccionar ${t.metadata.title}`}
                    onChange={() => toggleOne(t.id)} /></td>
                  <td className="num">{t.position}</td>
                  <td><Cover src={t.metadata.artworkPath} seed={t.metadata.title} /></td>
                  <td>{t.metadata.title}</td>
                  <td>{t.metadata.artist}</td>
                  <td>{t.metadata.album}</td>
                  <td className="num">{fmtDuration(t.durationSec)}</td>
                  <td>
                    {job ? <span className={`badge b-${job.status}`}>{job.status}</span> : <span className="pill">—</span>}
                    {job && (job.status === 'REINTENTANDO' || (job.status === 'PROCESANDO' && job.attempts > 1)) && (
                      <div style={{ color: 'var(--warn)', fontSize: 11, marginTop: 4 }}>
                        Retry {Math.max(0, job.attempts - 1)}/{job.maxAttempts}
                      </div>
                    )}
                    {job?.status === 'ERROR' && job.error && (
                      <div style={{ color: 'var(--err)', fontSize: 11, marginTop: 4 }} title={job.error}>{job.error.slice(0, 40)}</div>
                    )}
                  </td>
                  <td>
                    {job && active(job.status)
                      ? <div className="row" style={{ gap: 6 }}><ProgressBar value={job.progress} /><span className="mono" style={{ fontSize: 11 }}>{job.progress}%</span></div>
                      : job?.status === 'COMPLETADO' ? <span className="mono" style={{ color: 'var(--ok)', fontSize: 12 }}>100%</span>
                      : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                  </td>
                  <td className="num">{fmtBytes(job?.outputBytes ?? t.estimatedBytes)}</td>
                  <td>
                    <div className="row">
                      <button className="btn sm primary" onClick={() => enqueueOne(t)}
                        disabled={!t.sourcePath || (!!job && active(job.status))}>Procesar canción</button>
                      {job?.status === 'COMPLETADO' && job.outputPath &&
                        <button className="btn sm" onClick={() => play(job)}>▶</button>}
                      <button className="btn sm ghost" onClick={() => setEditing(t)}>Editar</button>
                      {job?.status === 'ERROR' && <button className="btn sm ghost" onClick={() => api.retryJob(job.id)}>Reintentar</button>}
                      {job && active(job.status) &&
                        <button className="btn sm ghost" onClick={() => api.cancelJob(job.id)}>Cancelar</button>}
                      {job?.status === 'COMPLETADO' && job.outputPath &&
                        <button className="btn sm ghost" onClick={() => api.openPath(job.outputPath!)}>Ubicación</button>}
                      <button className="btn sm ghost" title="Subir" disabled={tracks[0]?.id === t.id}
                        onClick={() => reorder(t, -1)}>↑</button>
                      <button className="btn sm ghost" title="Bajar" disabled={tracks[tracks.length - 1]?.id === t.id}
                        onClick={() => reorder(t, 1)}>↓</button>
                      <button className="btn sm ghost" onClick={() => remove(t)}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && <MetadataModal track={editing} onClose={() => setEditing(null)} onSaved={load} />}
      {bulkEditing && (
        <BulkMetadataModal trackIds={Array.from(selected)}
          onClose={() => setBulkEditing(false)}
          onSaved={async () => { await load(); await refreshPlaylists(); }} />
      )}
      {reviewing && <MatchReviewModal playlistId={playlist.id} onClose={() => setReviewing(false)} onChanged={load} />}
    </div>
  );
}
