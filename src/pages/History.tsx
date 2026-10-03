import { useMemo, useState } from 'react';
import { useStore, fmtBytes } from '../renderer/store.js';
import { computeWindow } from '../utils/virtual.js';

const ROW_H = 49;
const VIEWPORT_H = 560;

export function HistoryPage() {
  const { history, api, refreshHistory } = useStore();
  const [q, setQ] = useState('');
  const [result, setResult] = useState('todos');
  const [format, setFormat] = useState('todos');
  const [scrollTop, setScrollTop] = useState(0);

  const formats = useMemo(
    () => ['todos', ...Array.from(new Set(history.map((h) => h.format.toLowerCase())))],
    [history],
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return history.filter((h) => {
      if (result !== 'todos' && h.result !== result) return false;
      if (format !== 'todos' && h.format.toLowerCase() !== format) return false;
      if (needle && !(
        h.title.toLowerCase().includes(needle) ||
        h.artist.toLowerCase().includes(needle) ||
        h.album.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [history, q, result, format]);

  const clearAll = async () => {
    if (!window.confirm('¿Borrar todo el historial? Esto no elimina tus archivos de audio.')) return;
    await api.clearHistory();
    await refreshHistory();
  };

  return (
    <div>
      <h1 className="page-title">📜 Historial</h1>
      <p className="page-sub">Registro de conversiones completadas y con error.</p>

      <div className="row" style={{ marginBottom: 16 }}>
        <input placeholder="Buscar por título, artista o álbum…" value={q}
          onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        <select value={result} onChange={(e) => setResult(e.target.value)} style={{ width: 150 }}>
          <option value="todos">Todos</option>
          <option value="COMPLETADO">Completados</option>
          <option value="ERROR">Con error</option>
        </select>
        <select value={format} onChange={(e) => setFormat(e.target.value)} style={{ width: 120 }}>
          {formats.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button className="btn sm ghost" disabled={history.length === 0} onClick={clearAll}>🗑 Limpiar historial</button>
      </div>

      {history.length === 0 ? (
        <div className="empty">Sin entradas todavía.</div>
      ) : rows.length === 0 ? (
        <div className="empty">Ninguna entrada coincide con el filtro.</div>
      ) : (() => {
        const win = computeWindow(scrollTop, ROW_H, VIEWPORT_H, rows.length, 8);
        const visible = rows.slice(win.startIndex, win.endIndex);
        const bottom = win.totalHeight - win.offsetY - visible.length * ROW_H;
        return (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th><th>Título</th><th>Artista</th><th>Álbum</th>
                  <th>Formato</th><th className="num">Tamaño</th><th>Fuente</th>
                  <th>Resultado</th><th>Acciones</th>
                </tr>
              </thead>
            </table>
            <div style={{ maxHeight: VIEWPORT_H, overflowY: 'auto' }}
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
              <table>
                <tbody>
                  {win.offsetY > 0 && <tr style={{ height: win.offsetY }} aria-hidden><td /></tr>}
                  {visible.map((h) => (
                    <tr key={h.id} style={{ height: ROW_H }}>
                      <td>{new Date(h.date).toLocaleString()}</td>
                      <td>{h.title}</td>
                      <td>{h.artist}</td>
                      <td>{h.album}</td>
                      <td>{h.format.toUpperCase()}</td>
                      <td className="num">{fmtBytes(h.bytes)}</td>
                      <td><span className="pill">{h.provider}</span></td>
                      <td><span className={`badge b-${h.result}`}>{h.result}</span></td>
                      <td>
                        <div className="row">
                          {h.outputPath && (
                            <button className="btn sm ghost" onClick={() => api.openPath(h.outputPath!)}>Abrir ubicación</button>
                          )}
                          <button className="btn sm ghost" onClick={async () => { await api.deleteHistory(h.id); await refreshHistory(); }}>Eliminar</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {bottom > 0 && <tr style={{ height: bottom }} aria-hidden><td /></tr>}
                </tbody>
              </table>
            </div>
            <div className="page-sub" style={{ marginTop: 8 }}>
              {rows.length} de {history.length} entradas · virtualizadas
            </div>
          </div>
        );
      })()}
    </div>
  );
}
