import { useStore, fmtBytes } from '../renderer/store.js';
import { StatCard } from '../components/common.js';

// -- Inicio / Dashboard (datos reales desde SQLite + cola en vivo) -----------
export function HomePage({ go }: { go: (p: string) => void }) {
  const { dashboard } = useStore();
  const d = dashboard;
  return (
    <div>
      <h1 className="page-title">🏠 Dashboard</h1>
      <p className="page-sub">Resumen en tiempo real de tu biblioteca y tu actividad.</p>

      <div className="grid cards">
        <StatCard k="Canciones" v={d?.tracks ?? 0} />
        <StatCard k="Playlists" v={d?.playlists ?? 0} />
        <StatCard k="Conversiones" v={d?.conversionsTotal ?? 0} />
        <StatCard k="Completadas" v={d?.conversionsCompleted ?? 0} tone="ok" />
        <StatCard k="Errores" v={d?.conversionsErrors ?? 0} tone="err" />
        <StatCard k="Espacio usado" v={fmtBytes(d?.bytesUsed ?? 0)} />
      </div>

      <div className="grid cards" style={{ marginTop: 16 }}>
        <StatCard k="En cola" v={d?.queuePending ?? 0} tone="warn" />
        <StatCard k="Procesando" v={d?.queueProcessing ?? 0} tone="info" />
        <StatCard k="Errores en cola" v={d?.queueErrors ?? 0} tone="err" />
      </div>

      <div className="section-title">Acciones rápidas</div>
      <div className="row">
        <button className="btn primary" onClick={() => go('playlists')}>📋 Importar</button>
        <button className="btn" onClick={() => go('library')}>🎵 Biblioteca</button>
        <button className="btn" onClick={() => go('queue')}>⏳ Ver cola</button>
        <button className="btn ghost" onClick={() => go('demo')}>🧪 Demo</button>
      </div>

      <div className="section-title">Actividad reciente</div>
      {!d || d.recent.length === 0
        ? <div className="empty">Sin actividad todavía.</div>
        : <div className="table-wrap">
            <table>
              <thead><tr><th>Fecha</th><th>Canción</th><th>Artista</th><th>Formato</th>
                <th className="num">Tamaño</th><th>Resultado</th></tr></thead>
              <tbody>
                {d.recent.map((h) => (
                  <tr key={h.id}>
                    <td>{new Date(h.date).toLocaleString()}</td>
                    <td>{h.title}</td><td>{h.artist}</td><td>{h.format.toUpperCase()}</td>
                    <td className="num">{fmtBytes(h.bytes)}</td>
                    <td><span className={`badge b-${h.result}`}>{h.result}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
    </div>
  );
}

// -- Descargas (completados) ------------------------------------------------
export function DownloadsPage() {
  const { snapshot, api } = useStore();
  const done = snapshot.jobs.filter((j) => j.status === 'COMPLETADO');
  return (
    <div>
      <h1 className="page-title">⬇ Descargas</h1>
      <p className="page-sub">Archivos generados en la sesión actual: {done.length}.</p>
      {done.length === 0 ? <div className="empty">Nada completado todavía.</div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Archivo</th><th className="num">Tamaño</th><th>Acciones</th></tr></thead>
            <tbody>
              {done.map((j) => (
                <tr key={j.id}>
                  <td className="mono">{j.outputPath ?? '—'}</td>
                  <td className="num">{fmtBytes(j.outputBytes ?? 0)}</td>
                  <td>{j.outputPath && <button className="btn sm ghost" onClick={() => api.openPath(j.outputPath!)}>Abrir</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
