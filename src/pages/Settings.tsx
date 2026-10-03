import { useStore } from '../renderer/store.js';
import type {
  OutputFormat, Mp3Bitrate, DuplicatePolicy, SampleRate, ProcessPriority,
} from '../types/index.js';

export function SettingsPage() {
  const { settings, saveSettings, api } = useStore();
  if (!settings) return null;
  const { general, conversion, queue } = settings;

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 className="page-title">⚙️ Configuración</h1>

      <div className="section-title">General</div>
      <div className="card">
        <label className="field">
          <span className="lbl">Idioma</span>
          <select value={general.language} onChange={(e) => saveSettings({ general: { ...general, language: e.target.value as 'es' | 'en' } })}>
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="field">
          <span className="lbl">Tema</span>
          <select value={general.theme} onChange={(e) => {
            const theme = e.target.value as 'dark' | 'light';
            document.documentElement.setAttribute('data-theme', theme);
            void saveSettings({ general: { ...general, theme } });
          }}>
            <option value="dark">Oscuro</option>
            <option value="light">Claro</option>
          </select>
        </label>
        <label className="inline"><input type="checkbox" checked={general.startWithWindows}
          onChange={(e) => saveSettings({ general: { ...general, startWithWindows: e.target.checked } })} /> Iniciar con Windows</label>
        <br />
        <label className="inline"><input type="checkbox" checked={general.minimizeToTray}
          onChange={(e) => saveSettings({ general: { ...general, minimizeToTray: e.target.checked } })} /> Minimizar a la bandeja</label>
      </div>

      <div className="section-title">Spotify</div>
      <div className="card">
        <label className="field">
          <span className="lbl">Spotify Client ID</span>
          <input value={settings.spotify.clientId}
            placeholder="Pega aquí tu Client ID de Spotify Developer"
            onChange={(e) => saveSettings({ spotify: { ...settings.spotify, clientId: e.target.value.trim() } })} />
        </label>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
          OAuth de escritorio con PKCE. No uses Client Secret en esta aplicación.
          Registra exactamente <code>http://127.0.0.1:8974/callback</code> como Redirect URI.
        </div>
      </div>

      <div className="section-title">Descargas / Cola</div>
      <div className="card">
        <label className="field">
          <span className="lbl">Carpeta de salida</span>
          <div className="row">
            <input readOnly value={conversion.outputDir} />
            <button className="btn" onClick={async () => {
              const dir = await api.chooseOutputDir();
              if (dir) await saveSettings({ conversion: { ...conversion, outputDir: dir } });
            }}>Elegir…</button>
          </div>
        </label>
        <label className="field">
          <span className="lbl">Concurrencia (procesos simultáneos): {queue.concurrency}</span>
          <input type="range" min={1} max={5} value={queue.concurrency}
            onChange={(e) => saveSettings({ queue: { ...queue, concurrency: Number(e.target.value) } })} />
        </label>
        <label className="field">
          <span className="lbl">Reintentos máximos</span>
          <input type="number" min={1} max={20} value={queue.maxAttempts}
            onChange={(e) => saveSettings({ queue: { ...queue, maxAttempts: Number(e.target.value) } })} />
        </label>
        <label className="field">
          <span className="lbl">Tiempo de espera (segundos)</span>
          <input type="number" min={5} max={600} value={queue.timeoutSec}
            onChange={(e) => saveSettings({ queue: { ...queue, timeoutSec: Number(e.target.value) } })} />
        </label>
        <label className="field">
          <span className="lbl">Prioridad del proceso</span>
          <select value={queue.priority}
            onChange={(e) => saveSettings({ queue: { ...queue, priority: e.target.value as ProcessPriority } })}>
            <option value="low">Baja</option>
            <option value="normal">Normal</option>
            <option value="high">Alta</option>
          </select>
        </label>
        <label className="field">
          <span className="lbl">Duplicados</span>
          <select value={conversion.duplicatePolicy}
            onChange={(e) => saveSettings({ conversion: { ...conversion, duplicatePolicy: e.target.value as DuplicatePolicy } })}>
            <option value="OMITIR">Omitir</option>
            <option value="SOBRESCRIBIR">Sobrescribir</option>
            <option value="RENOMBRAR">Renombrar</option>
            <option value="CREAR_COPIA">Crear copia</option>
          </select>
        </label>
      </div>

      <div className="section-title">Audio</div>
      <div className="card">
        <label className="field">
          <span className="lbl">Formato de salida</span>
          <select value={conversion.outputFormat}
            onChange={(e) => saveSettings({ conversion: { ...conversion, outputFormat: e.target.value as OutputFormat } })}>
            <option value="mp3">MP3</option>
            <option value="flac">FLAC (lossless)</option>
            <option value="wav">WAV</option>
            <option value="m4a">M4A (AAC)</option>
            <option value="aac">AAC (ADTS)</option>
            <option value="aiff">AIFF</option>
          </select>
        </label>
        <label className="field">
          <span className="lbl">Bitrate MP3/M4A/AAC</span>
          <select value={conversion.mp3Bitrate}
            onChange={(e) => saveSettings({ conversion: { ...conversion, mp3Bitrate: Number(e.target.value) as Mp3Bitrate } })}>
            {[128, 192, 256, 320].map((b) => <option key={b} value={b}>{b} kbps</option>)}
          </select>
        </label>
        <label className="field">
          <span className="lbl">Sample rate</span>
          <select value={conversion.sampleRate}
            onChange={(e) => saveSettings({ conversion: { ...conversion, sampleRate: Number(e.target.value) as SampleRate } })}>
            <option value={0}>Conservar origen</option>
            <option value={44100}>44.1 kHz</option>
            <option value={48000}>48 kHz</option>
            <option value={88200}>88.2 kHz</option>
            <option value={96000}>96 kHz</option>
          </select>
        </label>
      </div>

      <div className="section-title">Metadata y organización</div>
      <div className="card">
        <label className="inline"><input type="checkbox" checked={conversion.writeMetadata}
          onChange={(e) => saveSettings({ conversion: { ...conversion, writeMetadata: e.target.checked } })} /> Escribir metadatos</label>
        <br />
        <label className="inline"><input type="checkbox" checked={conversion.embedArtwork}
          onChange={(e) => saveSettings({ conversion: { ...conversion, embedArtwork: e.target.checked } })} /> Incrustar portada</label>
        <label className="field" style={{ marginTop: 14 }}>
          <span className="lbl">Plantilla de organización</span>
          <select value={conversion.namingTemplate}
            onChange={(e) => saveSettings({ conversion: { ...conversion, namingTemplate: e.target.value } })}>
            <option value="{artist} - {title}">{'{artist} - {title}'}</option>
            <option value="{track} - {artist} - {title}">{'{track} - {artist} - {title}'}</option>
            <option value="{artist}/{album}/{track} - {title}">{'{artist}/{album}/{track} - {title}'}</option>
          </select>
        </label>
      </div>
    </div>
  );
}
