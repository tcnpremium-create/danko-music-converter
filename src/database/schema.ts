// ============================================================================
// Esquema SQL versionado. Cada migración es idempotente y se aplica en orden.
// La versión se guarda en PRAGMA user_version para sobrevivir a actualizaciones.
// ============================================================================

export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS playlists (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        provider      TEXT NOT NULL,
        artworkPath   TEXT,
        trackCount    INTEGER NOT NULL DEFAULT 0,
        totalDuration INTEGER NOT NULL DEFAULT 0,
        estimatedBytes INTEGER NOT NULL DEFAULT 0,
        createdAt     INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tracks (
        id            TEXT PRIMARY KEY,
        playlistId    TEXT NOT NULL,
        position      INTEGER NOT NULL,
        title         TEXT NOT NULL,
        artist        TEXT NOT NULL,
        album         TEXT NOT NULL,
        albumArtist   TEXT,
        genre         TEXT,
        year          INTEGER,
        trackNumber   INTEGER,
        discNumber    INTEGER,
        comment       TEXT,
        artworkPath   TEXT,
        durationSec   REAL NOT NULL DEFAULT 0,
        sourceFormat  TEXT NOT NULL,
        sourcePath    TEXT,
        provider      TEXT NOT NULL,
        estimatedBytes INTEGER NOT NULL DEFAULT 0,
        dupHash       TEXT,
        FOREIGN KEY (playlistId) REFERENCES playlists(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id            TEXT PRIMARY KEY,
        playlistId    TEXT NOT NULL,
        trackId       TEXT NOT NULL,
        status        TEXT NOT NULL,
        progress      REAL NOT NULL DEFAULT 0,
        attempts      INTEGER NOT NULL DEFAULT 0,
        maxAttempts   INTEGER NOT NULL DEFAULT 3,
        nextAttemptAt INTEGER,
        error         TEXT,
        outputPath    TEXT,
        outputBytes   INTEGER,
        createdAt     INTEGER NOT NULL,
        updatedAt     INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS history (
        id         TEXT PRIMARY KEY,
        date       INTEGER NOT NULL,
        title      TEXT NOT NULL,
        artist     TEXT NOT NULL,
        album      TEXT NOT NULL,
        format     TEXT NOT NULL,
        bytes      INTEGER NOT NULL DEFAULT 0,
        provider   TEXT NOT NULL,
        result     TEXT NOT NULL,
        outputPath TEXT
      );

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS errors (
        id        TEXT PRIMARY KEY,
        jobId     TEXT NOT NULL,
        message   TEXT NOT NULL,
        attempt   INTEGER NOT NULL,
        createdAt INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tracks_playlist ON tracks(playlistId);
      CREATE INDEX IF NOT EXISTS idx_tracks_duphash  ON tracks(dupHash);
      CREATE INDEX IF NOT EXISTS idx_jobs_playlist   ON jobs(playlistId);
      CREATE INDEX IF NOT EXISTS idx_jobs_status     ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_history_date    ON history(date);
      CREATE INDEX IF NOT EXISTS idx_errors_job      ON errors(jobId);
    `,
  },
  {
    // v2: compositor e ISRC en las pistas (metadatos ampliados).
    version: 2,
    sql: `
      ALTER TABLE tracks ADD COLUMN composer TEXT;
      ALTER TABLE tracks ADD COLUMN isrc TEXT;
    `,
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
