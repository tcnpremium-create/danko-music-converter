# Changelog

All notable changes to Danko Music Converter are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Isolated MCP server skeleton (`mcp/`) exposing scoped audio/library tools,
  ready for Claude and ChatGPT clients. Destructive operations require
  confirmation; no generic system access.
- `ARCHITECTURE.md` describing the Core Audio / Metadata / Library / AI-MCP
  layering.
- Project hygiene: `LICENSE` (MIT), `SECURITY.md`, `CONTRIBUTING.md`,
  `.env.example`, issue/PR templates.

### Changed
- Renamed product to **Danko Music Converter** and established it as an
  independent project with its own Git history (migrated, audited and
  secret-scanned from the previous monorepo source).

## [1.0.0] — 2026-10-01

Initial converter core (migrated baseline).

### Added
- Audio conversion via FFmpeg: MP3, WAV, FLAC, M4A, AAC, AIFF.
- Professional conversion queue: concurrency, priority, retry with backoff,
  pause/resume, cancel, per-job and global progress, ETA/speed, reordering.
- Library with search/filter/sort and list virtualization (thousands of rows).
- Playlists CRUD (create/rename/duplicate/delete/reorder/export M3U).
- Metadata editing (title/artist/album/year/genre/track/comment/artwork,
  composer, ISRC) across supported formats.
- Dashboard with real stats from local SQLite; functional history with filters.
- Local audio player (play/seek/volume/mute/prev/next).
- Spotify **metadata-only** import (desktop OAuth with PKCE; no client secret).
- Versioned SQLite migrations; interrupted-queue recovery.
- Electron security hardening: context isolation, strict CSP, blocked external
  navigation and webview attachment.

[Unreleased]: https://github.com/tcnpremium-create/danko-music-converter/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/tcnpremium-create/danko-music-converter/releases/tag/v1.0.0
