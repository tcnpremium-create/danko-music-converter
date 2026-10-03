// Modal de revisión de coincidencias Spotify → biblioteca local.
// Usa el backend probado: api.matchPlaylist (puntuación anti-falsos-positivos)
// y api.acceptMatch (asociación manual). Permite aceptar / rechazar / reintentar.
import { useEffect, useState } from 'react';
import { useStore } from '../renderer/store.js';
import type { MatchRow } from '../types/index.js';

const VERDICT_LABEL: Record<MatchRow['verdict'], string> = {
  MATCH: 'Coincidencia', PROBABLE: 'Probable', REVISAR: 'Revisar', SIN_MATCH: 'Sin match',
};
const VERDICT_CLASS: Record<MatchRow['verdict'], string> = {
  MATCH: 'b-COMPLETADO', PROBABLE: 'b-PROCESANDO', REVISAR: 'b-REINTENTANDO', SIN_MATCH: 'b-ERROR',
};

function baseName(p: string | null): string {
  if (!p) return '—';
  return p.split(/[\\/]/).pop() ?? p;
}

export function MatchReviewModal({
  playlistId, onClose, onChanged,
}: { playlistId: string; onClose: () => void; onChanged: () => void }) {
  const { api } = useStore();
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = async () => { setRows(await api.matchPlaylist(playlistId)); };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [playlistId]);

  const accept = async (r: MatchRow) => {
    if (!r.candidatePath) return;
    setBusy(true);
    try {
      await api.acceptMatch(r.trackId, r.candidatePath);
      setAccepted((s) => new Set(s).add(r.trackId));
      onChanged();
    } finally { setBusy(false); }
  };
  const reject = (r: MatchRow) => setRejected((s) => new Set(s).add(r.trackId));

  const counts = rows
    ? {
        match: rows.filter((r) => r.verdict === 'MATCH').length,
        probable: rows.filter((r) => r.verdict === 'PROBABLE').length,
        revisar: rows.filter((r) => r.verdict === 'REVISAR').length,
        sin: rows.filter((r) => r.verdict === 'SIN_MATCH').length,
      }
    : null;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ width: 820, maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}>
        <h2>Revisión de coincidencias</h2>
        {counts && (
          <p className="page-sub">
            {counts.match} coincidencias · {counts.probable} probables · {counts.revisar} a revisar · {counts.sin} sin match
          </p>
        )}
        {rows === null ? (
          <div className="empty">Analizando coincidencias…</div>
        ) : rows.length === 0 ? (
          <div className="empty">La playlist no tiene pistas.</div>
        ) : (
          <div className="table-wrap" style={{ overflowY: 'auto' }}>
            <table>
              <thead>
                <tr><th>Canción</th><th>Artista</th><th>Score</th><th>Veredicto</th>
                  <th>Archivo local</th><th>Acción</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isAcc = accepted.has(r.trackId);
                  const isRej = rejected.has(r.trackId);
                  return (
                    <tr key={r.trackId} style={{ opacity: isRej ? 0.45 : 1 }}>
                      <td>{r.title}</td>
                      <td>{r.artist}</td>
                      <td className="mono">{r.score}</td>
                      <td><span className={`badge ${VERDICT_CLASS[r.verdict]}`} title={r.reasons.join(' · ')}>
                        {VERDICT_LABEL[r.verdict]}</span></td>
                      <td className="mono" title={r.candidatePath ?? ''}>{baseName(r.candidatePath)}</td>
                      <td>
                        {isAcc ? <span className="pill">Aceptado ✓</span>
                          : isRej ? <span className="pill">Rechazado</span>
                          : (
                            <div className="row">
                              <button className="btn sm primary" disabled={busy || !r.candidatePath}
                                onClick={() => accept(r)}>Aceptar</button>
                              <button className="btn sm ghost" onClick={() => reject(r)}>Rechazar</button>
                            </div>
                          )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={() => void load()} disabled={busy}>Reanalizar</button>
          <button className="btn primary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
