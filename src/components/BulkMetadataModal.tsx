import { useState } from 'react';
import type { TrackMetadataPatch } from '../types/index.js';
import { useStore } from '../renderer/store.js';

// Edición de metadatos en lote: solo se aplican los campos marcados "cambiar",
// de modo que un campo vacío nunca borra el valor existente de cada pista.
type FieldKey = 'artist' | 'album' | 'albumArtist' | 'genre' | 'year';

const FIELDS: { key: FieldKey; label: string; type?: string }[] = [
  { key: 'artist', label: 'Artista' },
  { key: 'album', label: 'Álbum' },
  { key: 'albumArtist', label: 'Artista del álbum' },
  { key: 'genre', label: 'Género' },
  { key: 'year', label: 'Año', type: 'number' },
];

export function BulkMetadataModal({
  trackIds, onClose, onSaved,
}: { trackIds: string[]; onClose: () => void; onSaved: () => void }) {
  const { api } = useStore();
  const [enabled, setEnabled] = useState<Record<FieldKey, boolean>>({
    artist: false, album: false, albumArtist: false, genre: false, year: false,
  });
  const [values, setValues] = useState<Record<FieldKey, string>>({
    artist: '', album: '', albumArtist: '', genre: '', year: '',
  });
  const [busy, setBusy] = useState(false);

  const anyEnabled = FIELDS.some((f) => enabled[f.key]);

  const save = async () => {
    setBusy(true);
    try {
      const patch: TrackMetadataPatch = {};
      for (const f of FIELDS) {
        if (!enabled[f.key]) continue;
        if (f.key === 'year') {
          const n = Number(values.year);
          patch.year = values.year === '' ? undefined : n;
        } else {
          patch[f.key] = values[f.key];
        }
      }
      for (const id of trackIds) await api.updateTrackMetadata(id, patch);
      onSaved();
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <h2>Editar metadatos en lote</h2>
        <p className="page-sub">
          Se aplicará a {trackIds.length} {trackIds.length === 1 ? 'canción' : 'canciones'}.
          Marca solo los campos que quieras cambiar.
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          {FIELDS.map((f) => (
            <label key={f.key} className="row" style={{ gap: 10, alignItems: 'center' }}>
              <input type="checkbox" checked={enabled[f.key]}
                onChange={(e) => setEnabled((s) => ({ ...s, [f.key]: e.target.checked }))} />
              <span style={{ width: 130 }}>{f.label}</span>
              <input type={f.type ?? 'text'} value={values[f.key]} disabled={!enabled[f.key]}
                style={{ flex: 1 }}
                onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))} />
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" disabled={busy || !anyEnabled} onClick={save}>
            Aplicar a seleccionadas
          </button>
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
