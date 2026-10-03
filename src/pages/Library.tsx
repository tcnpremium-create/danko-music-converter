import { useMemo, useRef, useState } from 'react';
import { useStore, fmtBytes } from '../renderer/store.js';
import { Cover } from '../components/Cover.js';
import { computeWindow } from '../utils/virtual.js';

type SortKey = 'title' | 'artist' | 'album' | 'date' | 'bytes';

const ROW_H = 49;      // alto aproximado de fila (px)
const VIEWPORT_H = 560; // alto visible de la tabla virtualizada

export function LibraryPage() {
  const { library, api, setNowPlaying } = useStore();
  const [q, setQ] = useState('');
  const [format, setFormat] = useState('todos');
  const [sort, setSort] = useState<SortKey>('date');
  const [asc, setAsc] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const formats = useMemo(
    () => ['todos', ...Array.from(new Set(library.map((l) => l.format.toLowerCase())))],
    [library],
  );

  const rows = useMemo(() => {
    let r = library.slice();
    const needle = q.trim().toLowerCase();
    if (needle) {
      r = r.filter((l) =>
        l.title.toLowerCase().includes(needle) ||
        l.artist.toLowerCase().includes(needle) ||
        l.album.toLowerCase().includes(needle));
    }
    if (format !== 'todos') r = r.filter((l) => l.format.toLowerCase() === format);
    r.sort((a, b) => {
      let cmp = 0;
      if (sort === 'date' || sort === 'bytes') cmp = a[sort] - b[sort];
      else cmp = String(a[sort]).localeCompare(String(b[sort]));
      return asc ? cmp : -cmp;
    });
    return r;
  }, [library, q, format, sort, asc]);

  return (
    <div>
      <h1 className="page-title">🎵 Biblioteca</h1>
      <p className="page-sub">{library.length} archivos procesados.</p>

      <div className="row" style={{ marginBottom: 16 }}>
        <input placeholder="Buscar por título, artista o álbum…" value={q}
          onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        <select value={format} onChange={(e) => setFormat(e.target.value)} style={{ width: 120 }}>
          {formats.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={{ width: 150 }}>
          <option value="date">Fecha</option>
          <option value="title">Título</option>
          <option value="artist">Artista</option>
          <option value="album">Álbum</option>
          <option value="bytes">Tamaño</option>
        </select>
        <button className="btn sm ghost" onClick={() => setAsc((v) => !v)}>{asc ? '↑' : '↓'}</button>
      </div>

      {rows.length === 0 ? (
        <div className="empty">No hay archivos que coincidan.</div>
      ) : (() => {
        // Virtualización: solo se renderizan las filas visibles aunque haya miles.
        const win = computeWindow(scrollTop, ROW_H, VIEWPORT_H, rows.length, 8);
        const visible = rows.slice(win.startIndex, win.endIndex);
        const bottom = win.totalHeight - win.offsetY - visible.length * ROW_H;
        return (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th></th><th>Título</th><th>Artista</th><th>Álbum</th><th>Formato</th>
                  <th className="num">Tamaño</th><th>Acciones</th></tr>
              </thead>
            </table>
            <div ref={scrollRef} style={{ maxHeight: VIEWPORT_H, overflowY: 'auto' }}
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
              <table>
                <tbody>
                  {win.offsetY > 0 && <tr style={{ height: win.offsetY }} aria-hidden><td /></tr>}
                  {visible.map((l) => (
                    <tr key={l.id} style={{ height: ROW_H }}>
                      <td><Cover seed={l.title} /></td>
                      <td>{l.title}{!l.exists && <span className="pill" style={{ marginLeft: 6 }}>ausente</span>}</td>
                      <td>{l.artist}</td>
                      <td>{l.album}</td>
                      <td>{l.format.toUpperCase()}</td>
                      <td className="num">{fmtBytes(l.bytes)}</td>
                      <td>
                        <div className="row">
                          <button className="btn sm primary" disabled={!l.exists}
                            onClick={() => setNowPlaying({ title: l.title, artist: l.artist, path: l.path })}>▶</button>
                          <button className="btn sm ghost" disabled={!l.exists}
                            onClick={() => api.openPath(l.path)}>Carpeta</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {bottom > 0 && <tr style={{ height: bottom }} aria-hidden><td /></tr>}
                </tbody>
              </table>
            </div>
            <div className="page-sub" style={{ marginTop: 8 }}>
              {rows.length} resultados · virtualizados (solo se renderizan las filas visibles)
            </div>
          </div>
        );
      })()}
    </div>
  );
}
