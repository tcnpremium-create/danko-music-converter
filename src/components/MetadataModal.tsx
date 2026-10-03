import { useState } from 'react';
import type { Track, TrackMetadataPatch } from '../types/index.js';
import { useStore } from '../renderer/store.js';

export function MetadataModal({
  track, onClose, onSaved,
}: { track: Track; onClose: () => void; onSaved: () => void }) {
  const { api } = useStore();
  const m = track.metadata;
  const [form, setForm] = useState<TrackMetadataPatch>({
    title: m.title, artist: m.artist, album: m.album, albumArtist: m.albumArtist,
    genre: m.genre, year: m.year, trackNumber: m.trackNumber, discNumber: m.discNumber,
    comment: m.comment, composer: m.composer, isrc: m.isrc,
  });
  const [busy, setBusy] = useState(false);

  const set = (k: keyof TrackMetadataPatch, v: string) =>
    setForm((f) => ({ ...f, [k]: k === 'year' || k === 'trackNumber' || k === 'discNumber'
      ? (v === '' ? undefined : Number(v)) : v }));

  const save = async () => {
    setBusy(true);
    try {
      await api.updateTrackMetadata(track.id, form);
      onSaved();
      onClose();
    } finally { setBusy(false); }
  };

  const field = (label: string, key: keyof TrackMetadataPatch, type = 'text') => (
    <label className="field">
      <span className="lbl">{label}</span>
      <input type={type} value={(form[key] as string | number | undefined) ?? ''}
        onChange={(e) => set(key, e.target.value)} />
    </label>
  );

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <h2>Editar metadatos</h2>
        <p className="page-sub">{track.metadata.title}</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          {field('Título', 'title')}
          {field('Artista', 'artist')}
          {field('Álbum', 'album')}
          {field('Artista del álbum', 'albumArtist')}
          {field('Género', 'genre')}
          {field('Año', 'year', 'number')}
          {field('Nº pista', 'trackNumber', 'number')}
          {field('Nº disco', 'discNumber', 'number')}
          {field('Compositor', 'composer')}
          {field('ISRC', 'isrc')}
        </div>
        {field('Comentario', 'comment')}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={busy} onClick={save}>Guardar</button>
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
