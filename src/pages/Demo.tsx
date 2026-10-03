import { useState } from 'react';
import { useStore } from '../renderer/store.js';
import { Dashboard } from '../components/common.js';

export function DemoPage({ onGoQueue }: { onGoQueue: () => void }) {
  const { settings, saveSettings, api, snapshot } = useStore();
  const [busy, setBusy] = useState(false);
  if (!settings) return null;
  const d = settings.demo;

  const startDemo = async () => {
    setBusy(true);
    try {
      const { playlist } = await api.importDemo(d.trackCount);
      await api.enqueue(playlist.id);
      await api.startQueue();
      onGoQueue();
    } finally { setBusy(false); }
  };

  return (
    <div>
      <h1 className="page-title">🧪 Modo Demo</h1>
      <p className="page-sub">
        Genera contenido sintético local para demostrar todo el flujo —análisis, progreso,
        velocidades, errores, reintentos y finalización— sin depender de ninguna fuente externa.
      </p>

      <div className="card" style={{ maxWidth: 520, marginBottom: 20 }}>
        <label className="field">
          <span className="lbl">Canciones</span>
          <div className="row" style={{ marginBottom: 8 }}>
            {[10, 50, 100, 500].map((n) => (
              <button key={n} className={`btn sm ${d.trackCount === n ? 'primary' : 'ghost'}`}
                onClick={() => saveSettings({ demo: { ...d, trackCount: n } })}>{n}</button>
            ))}
          </div>
          <input type="number" min={1} max={1000} value={d.trackCount}
            onChange={(e) => saveSettings({ demo: { ...d, trackCount: Number(e.target.value) } })} />
        </label>
        <label className="field">
          <span className="lbl">Probabilidad de error: {Math.round(d.errorProbability * 100)}%</span>
          <input type="range" min={0} max={100} value={Math.round(d.errorProbability * 100)}
            onChange={(e) => saveSettings({ demo: { ...d, errorProbability: Number(e.target.value) / 100 } })} />
        </label>
        <label className="field">
          <span className="lbl">Velocidad (MB/s): {(d.speedBytesPerSec / (1024 * 1024)).toFixed(1)}</span>
          <input type="range" min={1} max={20} value={Math.round(d.speedBytesPerSec / (1024 * 1024))}
            onChange={(e) => saveSettings({ demo: { ...d, speedBytesPerSec: Number(e.target.value) * 1024 * 1024 } })} />
        </label>
        <label className="field">
          <span className="lbl">Fallo forzado en la canción nº (para la prueba especial; vacío = ninguna)</span>
          <input type="number" min={1} max={d.trackCount}
            value={d.forcedFailureIndex != null ? d.forcedFailureIndex + 1 : ''}
            placeholder="p. ej. 47"
            onChange={(e) => {
              const v = e.target.value.trim();
              saveSettings({ demo: { ...d, forcedFailureIndex: v === '' ? null : Number(v) - 1 } });
            }} />
        </label>
        <button className="btn primary" disabled={busy} onClick={startDemo}>▶ Iniciar demo</button>
      </div>

      <Dashboard stats={snapshot.stats} running={snapshot.running} />
    </div>
  );
}
