// Reproductor local sencillo (barra inferior). Reproduce solo archivos locales
// disponibles, servidos por el protocolo seguro danko-media://.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../renderer/store.js';
import { Cover } from './Cover.js';

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function Player() {
  const { nowPlaying, setNowPlaying, library, api } = useStore();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(1);
  const [muted, setMuted] = useState(false);

  // Índice de la pista actual dentro de la biblioteca (para prev/next).
  const idx = nowPlaying ? library.findIndex((l) => l.path === nowPlaying.path) : -1;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !nowPlaying) return;
    audio.src = api.mediaUrl(nowPlaying.path);
    audio.volume = vol;
    void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowPlaying?.path]);

  if (!nowPlaying) return null;

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { void a.play(); setPlaying(true); } else { a.pause(); setPlaying(false); }
  };
  const jump = (delta: number) => {
    if (idx < 0) return;
    const next = library[idx + delta];
    if (next && next.exists) setNowPlaying({ title: next.title, artist: next.artist, path: next.path });
  };
  const toggleMute = () => {
    const a = audioRef.current;
    const next = !muted;
    setMuted(next);
    if (a) a.muted = next;
  };

  return (
    <div className="player">
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        onEnded={() => { setPlaying(false); jump(1); }}
      />
      <div className="row" style={{ gap: 12, minWidth: 220 }}>
        <Cover seed={nowPlaying.title} size={42} />
        <div style={{ overflow: 'hidden' }}>
          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{nowPlaying.title}</div>
          <div className="muted" style={{ color: 'var(--text-dim)', fontSize: 12 }}>{nowPlaying.artist}</div>
        </div>
      </div>

      <div className="player-center">
        <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
          <button className="btn sm ghost" onClick={() => jump(-1)} disabled={idx <= 0}>⏮</button>
          <button className="btn sm primary" onClick={toggle}>{playing ? '⏸' : '▶'}</button>
          <button className="btn sm ghost" onClick={() => jump(1)} disabled={idx < 0 || idx >= library.length - 1}>⏭</button>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{fmtTime(cur)}</span>
          <input type="range" min={0} max={dur || 0} step={0.1} value={cur}
            onChange={(e) => { const a = audioRef.current; if (a) { a.currentTime = Number(e.target.value); } }}
            style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{fmtTime(dur)}</span>
        </div>
      </div>

      <div className="row" style={{ gap: 8, minWidth: 150, justifyContent: 'flex-end' }}>
        <button className="btn sm ghost" title={muted ? 'Activar sonido' : 'Silenciar'} onClick={toggleMute}>
          {muted || vol === 0 ? '🔇' : '🔊'}
        </button>
        <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : vol}
          onChange={(e) => {
            const v = Number(e.target.value);
            setVol(v); setMuted(false);
            if (audioRef.current) { audioRef.current.volume = v; audioRef.current.muted = false; }
          }}
          style={{ width: 90 }} />
        <button className="btn sm ghost" onClick={() => setNowPlaying(null)}>✕</button>
      </div>
    </div>
  );
}
