import { useEffect, useState } from 'react';
import { useStore } from '../renderer/store.js';
import { Dashboard } from '../components/common.js';
import { JobTable } from '../components/JobTable.js';
import type { Track } from '../types/index.js';

export function QueuePage() {
  const { snapshot, api } = useStore();
  const [tracks, setTracks] = useState<Map<string, Track>>(new Map());

  // Cargar los tracks de las playlists presentes en la cola (para la tabla).
  useEffect(() => {
    const playlistIds = [...new Set(snapshot.jobs.map((j) => j.playlistId))];
    let cancelled = false;
    void (async () => {
      const map = new Map<string, Track>();
      for (const pid of playlistIds) {
        const ts = await api.getTracks(pid);
        for (const t of ts) map.set(t.id, t);
      }
      if (!cancelled) setTracks(map);
    })();
    return () => { cancelled = true; };
    // Recargar solo cuando cambia el conjunto de playlists en cola.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.jobs.map((j) => j.playlistId).join(',')]);

  return (
    <div>
      <h1 className="page-title">⏳ Cola</h1>
      <p className="page-sub">Cada canción es un trabajo independiente. Un fallo nunca detiene la cola.</p>

      <Dashboard stats={snapshot.stats} running={snapshot.running} />

      <div className="row between" style={{ margin: '18px 0' }}>
        <div className="row">
          {snapshot.running
            ? <button className="btn" onClick={() => api.pauseQueue()}>⏸ Pausar todo</button>
            : <button className="btn primary" onClick={() => api.startQueue()}>▶ Iniciar todo</button>}
          <button className="btn ghost" onClick={() => api.cancelAll()}
            disabled={snapshot.stats.pending + snapshot.stats.processing === 0}>⛔ Cancelar todo</button>
          <button className="btn ghost" onClick={() => api.retryFailed()}
            disabled={snapshot.stats.errors === 0}>↻ Reintentar fallidos</button>
        </div>
        <div className="row">
          <button className="btn sm ghost" onClick={() => api.clearCompleted()}
            disabled={snapshot.stats.completed === 0}>Limpiar completados</button>
          <button className="btn sm ghost" onClick={() => api.clearFailed()}
            disabled={snapshot.stats.errors === 0}>Limpiar fallidos</button>
        </div>
      </div>

      <JobTable jobs={snapshot.jobs} tracks={tracks} />
    </div>
  );
}
