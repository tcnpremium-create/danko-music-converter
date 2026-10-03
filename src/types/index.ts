// ============================================================================
// Danko Music Converter — Modelo de dominio compartido (main + renderer)
// ============================================================================

export type JobStatus =
  | 'PENDIENTE'
  | 'ANALIZANDO'
  | 'PROCESANDO'
  | 'COMPLETADO'
  | 'ERROR'
  | 'REINTENTANDO'
  | 'CANCELADO'
  | 'OMITIDO';

export type AudioFormat = 'mp3' | 'flac' | 'wav' | 'm4a' | 'aac' | 'aiff' | 'ogg';
export type OutputFormat = 'mp3' | 'flac' | 'wav' | 'm4a' | 'aac' | 'aiff';
export type Mp3Bitrate = 128 | 192 | 256 | 320;

/** Estrategia ante duplicados detectados en la biblioteca de salida. */
export type DuplicatePolicy = 'OMITIR' | 'SOBRESCRIBIR' | 'RENOMBRAR' | 'CREAR_COPIA';

export type ProviderId = 'local' | 'authorized' | 'demo' | 'spotify';

export interface AudioMetadata {
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  discNumber?: number;
  comment?: string;
  composer?: string;
  /** International Standard Recording Code, cuando esté disponible. */
  isrc?: string;
  /** Ruta local a la portada, o data URI para previsualización. */
  artworkPath?: string;
}

export interface Track {
  id: string;
  playlistId: string;
  position: number;
  metadata: AudioMetadata;
  durationSec: number;
  sourceFormat: AudioFormat;
  /** Ruta del archivo de origen (local/autorizado) — nunca contenido protegido. */
  sourcePath?: string;
  provider: ProviderId;
  estimatedBytes: number;
}

export interface Playlist {
  id: string;
  name: string;
  provider: ProviderId;
  artworkPath?: string;
  trackCount: number;
  totalDurationSec: number;
  estimatedBytes: number;
  createdAt: number;
}

export interface Job {
  id: string;
  playlistId: string;
  trackId: string;
  status: JobStatus;
  progress: number; // 0..100
  attempts: number;
  maxAttempts: number;
  /** Timestamp (ms) a partir del cual el job puede reintentarse (backoff). */
  nextAttemptAt: number | null;
  error: string | null;
  outputPath: string | null;
  outputBytes: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface HistoryEntry {
  id: string;
  date: number;
  title: string;
  artist: string;
  album: string;
  format: string;
  bytes: number;
  provider: ProviderId;
  result: 'COMPLETADO' | 'ERROR';
  outputPath: string | null;
}

/** 0 = conservar el sample rate de origen; en caso contrario, remuestrear. */
export type SampleRate = 0 | 44100 | 48000 | 88200 | 96000;

export interface ConversionSettings {
  outputFormat: OutputFormat;
  mp3Bitrate: Mp3Bitrate;
  sampleRate: SampleRate;
  outputDir: string;
  namingTemplate: string;
  embedArtwork: boolean;
  writeMetadata: boolean;
  duplicatePolicy: DuplicatePolicy;
}

/** Prioridad del proceso de conversión (afecta a la prioridad del proceso FFmpeg). */
export type ProcessPriority = 'low' | 'normal' | 'high';

export interface QueueSettings {
  concurrency: number; // 1..5
  maxAttempts: number; // >=3
  timeoutSec: number;
  backoffBaseMs: number;
  priority: ProcessPriority;
}

export interface DemoSettings {
  trackCount: number;
  errorProbability: number; // 0..1
  speedBytesPerSec: number;
  /** Índice de canción forzada a fallar (para la prueba especial). null = ninguna. */
  forcedFailureIndex: number | null;
}

export interface SpotifySettings {
  /** Spotify Developer Client ID. Never a client secret. */
  clientId: string;
  /** Local OAuth callback port registered in Spotify Developer Dashboard. */
  redirectPort: number;
}

export interface GeneralSettings {
  language: 'es' | 'en';
  theme: 'dark' | 'light';
  startWithWindows: boolean;
  minimizeToTray: boolean;
}

export interface AppSettings {
  general: GeneralSettings;
  conversion: ConversionSettings;
  queue: QueueSettings;
  demo: DemoSettings;
  spotify: SpotifySettings;
}

export interface DashboardStats {
  total: number;
  completed: number;
  processing: number;
  pending: number;
  errors: number;
  progressPct: number;
  etaSec: number | null;
  speedBytesPerSec: number;
}

export interface QueueSnapshot {
  jobs: Job[];
  stats: DashboardStats;
  running: boolean;
}

export interface InterruptedQueueInfo {
  playlistName: string;
  total: number;
  completed: number;
  processing: number;
  pending: number;
}

/** Un archivo ya procesado que existe en disco, para la Biblioteca. */
export interface LibraryItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string | null;
  year: number | null;
  format: string;
  bytes: number;
  date: number;
  path: string;
  exists: boolean;
}

/** Resumen del dashboard, todo desde datos reales (SQLite + cola en vivo). */
export interface DashboardSummary {
  tracks: number;
  playlists: number;
  conversionsTotal: number;
  conversionsCompleted: number;
  conversionsErrors: number;
  bytesUsed: number;
  queuePending: number;
  queueProcessing: number;
  queueErrors: number;
  recent: HistoryEntry[];
}

export type MatchVerdict = 'MATCH' | 'PROBABLE' | 'REVISAR' | 'SIN_MATCH';

/** Fila de revisión de matching (Spotify → biblioteca local). */
export interface MatchRow {
  trackId: string;
  title: string;
  artist: string;
  score: number;
  verdict: MatchVerdict;
  reasons: string[];
  candidateTrackId: string | null;
  candidatePath: string | null;
}

/** Metadatos editables desde la UI antes de guardar. */
export interface TrackMetadataPatch {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  discNumber?: number;
  comment?: string;
  composer?: string;
  isrc?: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    language: 'es',
    theme: 'dark',
    startWithWindows: false,
    minimizeToTray: true,
  },
  conversion: {
    outputFormat: 'mp3',
    mp3Bitrate: 320,
    sampleRate: 0,
    outputDir: '',
    namingTemplate: '{artist}/{album}/{track} - {title}',
    embedArtwork: true,
    writeMetadata: true,
    duplicatePolicy: 'OMITIR',
  },
  queue: {
    concurrency: 3,
    maxAttempts: 3,
    timeoutSec: 30,
    backoffBaseMs: 1000,
    priority: 'normal',
  },
  demo: {
    trackCount: 100,
    errorProbability: 0.05,
    speedBytesPerSec: 2 * 1024 * 1024,
    forcedFailureIndex: null,
  },
  spotify: {
    clientId: '',
    redirectPort: 8974,
  },
};
