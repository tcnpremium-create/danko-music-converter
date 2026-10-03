<div align="center">

# 🎧 Danko Music Converter

**A professional, local-first music workstation for DJs, producers and creators.**
Convert, analyze, tag and organize your library at scale — powered by FFmpeg,
designed to be driven by AI through the Model Context Protocol (MCP).

[![CI](https://github.com/tcnpremium-create/danko-music-converter/actions/workflows/ci.yml/badge.svg)](https://github.com/tcnpremium-create/danko-music-converter/actions)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-5b4bff)
![Electron](https://img.shields.io/badge/Electron-44-47848f)
![License](https://img.shields.io/badge/license-MIT-22c55e)

</div>

> **This is not a simple MP3 converter.** Danko Music Converter is built as a
> modern desktop audio app: a fast library, a professional batch queue, deep
> metadata tools, and a clean architecture ready for an AI assistant layer.

---

## ✨ Features

- **Batch conversion engine** — convert hundreds of files with an independent
  job queue: concurrency control, priorities, retries with backoff,
  pause/resume, cancel, per-job + global progress, ETA & speed, reordering.
- **Formats** — MP3, WAV, FLAC, AAC, M4A, AIFF (OGG and more where supported),
  with selectable bitrate, sample rate, channels and quality.
- **DJ-oriented presets** — *DJ MP3*, *High Quality*, *WAV Master*, *FLAC
  Archive*, *Custom*.
- **Library** — import files/folders with drag & drop, search, filter, sort,
  and virtualized lists that stay smooth with thousands of tracks.
- **Analyze** — duration, bitrate, sample rate, channels, format, size,
  metadata and artwork (BPM/key analysis on the roadmap).
- **Metadata editor** — title, artist, album, year, genre, track, comment,
  artwork, composer, ISRC — preserved through conversion.
- **Playlists** — create, rename, duplicate, delete, reorder, export (M3U).
- **Player** — preview audio with seek, volume, mute, prev/next.
- **Duplicate detection** — compares hash, name, size, duration & metadata;
  it **informs**, it never deletes your files automatically.
- **Local-first & private** — everything runs offline; no telemetry, no silent
  uploads.
- **AI-ready (MCP)** — an isolated MCP server exposes scoped tools so Claude or
  ChatGPT can analyze, convert and organize — with confirmation gates on
  destructive actions.

## 🖼️ Screenshots

> _Add screenshots / GIFs here once captured (`docs/media/`)._ The app opens
> with a premium dark splash screen and transitions into the dashboard.

## 🚀 Installation

### Windows (recommended)

Download `Danko Music Converter Setup.exe` from the
[Releases](https://github.com/tcnpremium-create/danko-music-converter/releases)
page and run it. FFmpeg is bundled — no extra setup.

> The installer may currently be **unsigned**; Windows SmartScreen will show
> *"Unknown publisher"*. Choose **More info → Run anyway**. Code signing is on
> the roadmap (requires an Authenticode certificate).

### From source (any platform)

```bash
git clone https://github.com/tcnpremium-create/danko-music-converter.git
cd danko-music-converter
npm install
npm run dev
```

See [INSTALLATION.md](./INSTALLATION.md) and [USER_GUIDE.md](./USER_GUIDE.md).

## 🧱 Architecture

```
            Danko Music Converter
                     │
        ┌────────────┼─────────────┐
        │            │             │
   Core Audio    Metadata       Library
    Engine        Engine       (SQLite)
        │            │             │
        └────────────┴─────────────┘
                     │
                AI / MCP Layer   ◄── isolated, scoped tools
                 /          \
            ChatGPT         Claude
```

- **Core Audio Engine** — FFmpeg conversion + the queue.
- **Metadata Engine** — read/write tags across formats.
- **Library** — local SQLite store (tracks, playlists, history) with versioned
  migrations.
- **AI / MCP Layer** — a **separate** process exposing only audio/library
  tools; the app runs fully without it. See [ARCHITECTURE.md](./ARCHITECTURE.md).

## 🤖 MCP · ChatGPT · Claude

The optional MCP server (`mcp/`) speaks the standard
[Model Context Protocol](https://modelcontextprotocol.io), so one server can
serve multiple compatible clients (Claude, ChatGPT via the Apps SDK, etc.).

Example tools: `search_library`, `get_track_metadata`, `analyze_audio`,
`convert_audio`, `create_preset`, `get_conversion_history`, `organize_files`,
`generate_report`.

**Safety by design:** the MCP server is *not* a shell. There is no arbitrary
command/file/delete tool, tools are scoped to Danko features, and destructive
operations (e.g. deleting tracks) require explicit confirmation. See
[`mcp/README.md`](./mcp/README.md).

## 🛠️ Tech stack

Electron 44 · React 19 · TypeScript 5 · Vite · Vitest · FFmpeg (`ffmpeg-static`)
· SQLite (`sql.js`, WASM) · music-metadata.

## 🧪 Development

```bash
npm run typecheck   # TypeScript
npm test            # unit + integration (Vitest)
npm run build       # main + preload + renderer
npm run e2e         # headless Electron smoke
npm run dist:win    # Windows installer (NSIS) — on Windows/CI
```

## 🗺️ Roadmap

- [ ] Premium splash + onboarding polish
- [ ] BPM / key detection in **Analyze**
- [ ] Waveform preview in the player
- [ ] Full MCP tool suite + remote endpoint & auth for ChatGPT Apps SDK
- [ ] Signed Windows installer + auto-update
- [ ] macOS build

## ❓ FAQ

**Does my music leave my computer?** No. Local features are fully offline.
Spotify import is **metadata only** and optional.

**Do I need an FFmpeg install?** No for the packaged app (bundled). For source
dev, FFmpeg on PATH or `DANKO_FFMPEG` is used.

**Is there a client secret for Spotify?** No. It uses desktop OAuth with PKCE
(public Client ID only).

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Issues and PRs welcome — we want
**organic** growth, no fake stars.

## 🔐 Security

Local-first, no secrets in the repo, scoped MCP. Report vulnerabilities
privately — see [SECURITY.md](./SECURITY.md).

## 📄 License

[MIT](./LICENSE). FFmpeg retains its own license.
