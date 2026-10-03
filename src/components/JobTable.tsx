// Tabla de jobs de la cola, con acciones por fila.
// Para colas grandes (> VIRTUALIZE_FROM) se virtualiza: solo se pintan las
// filas visibles. Para colas pequeñas se usa el render simple (permite que las
// filas con mensajes de error crezcan libremente).
import { useState } from 'react';
import type { Job, Track } from '../types/index.js';
import { StatusBadge, ProgressBar } from './common.js';
import { Cover } from './Cover.js';
import { fmtBytes, fmtDuration, useStore } from '../renderer/store.js';
import { computeWindow } from '../utils/virtual.js';

const VIRTUALIZE_FROM = 120;
const ROW_H = 64;
const VIEWPORT_H = 600;

export function JobTable({ jobs, tracks }: { jobs: Job[]; tracks: Map<string, Track> }) {
  const { api } = useStore();
  const [scrollTop, setScrollTop] = useState(0);
  if (jobs.length === 0) return <div className="empty">No hay trabajos en la cola.</div>;

  const Row = ({ job, i }: { job: Job; i: number }) => {
    const t = tracks.get(job.trackId);
    return (
      <tr style={{ height: ROW_H }}>
        <td className="num">{i + 1}</td>
        <td><Cover src={t?.metadata.artworkPath} seed={t?.metadata.title ?? job.id} /></td>
        <td>{t?.metadata.title ?? '—'}</td>
        <td>{t?.metadata.artist ?? '—'}</td>
        <td>{t?.metadata.album ?? '—'}</td>
        <td className="num">{t ? fmtDuration(t.durationSec) : '—'}</td>
        <td>
          <StatusBadge status={job.status} />
          {(job.status === 'REINTENTANDO' || (job.status === 'PROCESANDO' && job.attempts > 1)) && (
            <div style={{ color: 'var(--warn)', fontSize: 11, marginTop: 4 }}>
              Retry {Math.max(0, job.attempts - 1)}/{job.maxAttempts}
            </div>
          )}
          {job.error && job.status === 'ERROR' && (
            <div style={{ color: 'var(--err)', fontSize: 11, marginTop: 4 }} title={job.error}>
              {job.error.slice(0, 42)}
            </div>
          )}
        </td>
        <td><ProgressBar value={job.progress} /></td>
        <td className="num">{fmtBytes(job.outputBytes ?? 0)}</td>
        <td>
          <div className="row">
            {job.status === 'ERROR' && (
              <button className="btn sm" onClick={() => api.retryJob(job.id)}>Reintentar</button>
            )}
            {(job.status === 'PROCESANDO' || job.status === 'PENDIENTE' || job.status === 'REINTENTANDO') && (
              <button className="btn sm ghost" onClick={() => api.cancelJob(job.id)}>Cancelar</button>
            )}
            {job.status === 'COMPLETADO' && job.outputPath && (
              <button className="btn sm ghost" onClick={() => api.openPath(job.outputPath!)}>Abrir</button>
            )}
            {job.status === 'PENDIENTE' && (
              <>
                <button className="btn sm ghost" title="Subir" onClick={() => api.reorderJob(job.id, -1)}>↑</button>
                <button className="btn sm ghost" title="Bajar" onClick={() => api.reorderJob(job.id, 1)}>↓</button>
              </>
            )}
            {(job.status === 'COMPLETADO' || job.status === 'ERROR' || job.status === 'CANCELADO') && (
              <button className="btn sm ghost" title="Quitar de la cola" onClick={() => api.removeJob(job.id)}>✕</button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  const header = (
    <tr>
      <th className="num">#</th><th></th><th>Título</th><th>Artista</th><th>Álbum</th>
      <th className="num">Duración</th><th>Estado</th><th style={{ width: 160 }}>Progreso</th>
      <th className="num">Tamaño</th><th>Acciones</th>
    </tr>
  );

  if (jobs.length <= VIRTUALIZE_FROM) {
    return (
      <div className="table-wrap">
        <table>
          <thead>{header}</thead>
          <tbody>{jobs.map((job, i) => <Row key={job.id} job={job} i={i} />)}</tbody>
        </table>
      </div>
    );
  }

  const win = computeWindow(scrollTop, ROW_H, VIEWPORT_H, jobs.length, 8);
  const visible = jobs.slice(win.startIndex, win.endIndex);
  const bottom = win.totalHeight - win.offsetY - visible.length * ROW_H;
  return (
    <div className="table-wrap">
      <table><thead>{header}</thead></table>
      <div style={{ maxHeight: VIEWPORT_H, overflowY: 'auto' }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <table>
          <tbody>
            {win.offsetY > 0 && <tr style={{ height: win.offsetY }} aria-hidden><td /></tr>}
            {visible.map((job, k) => <Row key={job.id} job={job} i={win.startIndex + k} />)}
            {bottom > 0 && <tr style={{ height: bottom }} aria-hidden><td /></tr>}
          </tbody>
        </table>
      </div>
      <div className="page-sub" style={{ marginTop: 8 }}>
        {jobs.length} trabajos · virtualizados (solo se renderizan las filas visibles)
      </div>
    </div>
  );
}
