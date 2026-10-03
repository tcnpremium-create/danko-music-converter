# Architecture

Danko Music Converter is a desktop Electron app with a strict separation
between the **product core** and an **optional AI/MCP layer**. The app is fully
functional with the MCP layer absent.

```
                      Danko Music Converter (Electron)
┌──────────────────────────────────────────────────────────────────┐
│ Renderer (React)                                                   │
│   Splash → Dashboard: Library · Convert · Analyze · Queue ·        │
│   History · Player · Tools                                         │
│        │  (contextBridge: window.danko, typed IPC only)            │
│ ───────┼──────────────────────────────────────────────────────────│
│ Main process (Node)                                                │
│   AppService  ── orchestrates everything                           │
│     ├── Core Audio Engine   (converter/ + queue/)   ◄── FFmpeg     │
│     ├── Metadata Engine     (metadata/)             ◄── tags       │
│     ├── Library             (database/  SQLite WASM)               │
│     └── Providers           (local · folder · Spotify metadata)    │
└──────────────────────────────────────────────────────────────────┘
                              │
                              │  in-process service API (no shell)
                              ▼
                     ┌──────────────────┐
                     │   MCP Server      │  separate process (mcp/)
                     │   (scoped tools)  │
                     └───────┬───────────┘
                             │ Model Context Protocol (stdio / HTTP)
                     ┌───────┴────────┐
                   Claude           ChatGPT (Apps SDK)
```

## Layers

### 1. Core Audio Engine — `src/converter/`, `src/queue/`
- `ffmpeg.ts`: builds FFmpeg args per format (MP3/WAV/FLAC/AAC/M4A/AIFF),
  bitrate/sample-rate/channels, artwork & metadata embedding, progress parsing,
  cancellation, process registry.
- `QueueEngine`: independent jobs, concurrency, priority, backoff retries,
  pause/resume/cancel, persistence hooks, snapshot/job/drained events.

### 2. Metadata Engine — `src/metadata/`
- Reads tags/artwork via `music-metadata`; conversion preserves metadata.
- Write/patch flows live in `AppService` + `Database`.

### 3. Library — `src/database/`
- `sql.js` (SQLite compiled to WASM), persisted atomically to disk.
- Versioned migrations via `PRAGMA user_version` (see `schema.ts`).
- Entities: playlists, tracks, jobs, history, settings, errors.

### 4. Orchestration — `src/services/AppService.ts`
- The single high-level API the IPC layer calls. Owns settings, providers,
  queue, conversion, matching, dashboard, history, playlist CRUD.

### 5. IPC boundary — `src/types/ipc.ts`, `src/preload/preload.ts`, `src/main/main.ts`
- `contextIsolation: true`, `nodeIntegration: false`.
- The renderer only sees a typed `window.danko` surface — no `ipcRenderer`,
  no Node. External navigation and `webview` attachment are blocked; strict CSP.

### 6. AI / MCP Layer — `mcp/` (optional, isolated)
- A **separate** Node process that talks to the same core through a narrow,
  typed service API — **never** a shell or filesystem passthrough.
- Standard MCP so one server serves multiple clients (Claude, ChatGPT).
- See [`mcp/README.md`](./mcp/README.md) for the tool catalog and safety model.

## Data flow: a conversion

1. User drops files → provider imports → tracks stored in Library.
2. User enqueues → `QueueEngine` schedules jobs by concurrency/priority.
3. Each job: provider prepares input → `ffmpeg.ts` converts → output written.
4. Result recorded in History; Library/Dashboard refresh via push events.

## Why the MCP layer is isolated

- **Resilience:** the app works offline with no AI client attached.
- **Security:** AI clients get *capabilities*, not a computer. Tools map 1:1 to
  product features; destructive ones require confirmation (see MCP docs).
- **Portability:** the same MCP server serves any MCP-compatible client.

## Roadmap hooks

- `analyze_audio` will grow BPM/key detection in the Metadata/Analyze path.
- A remote MCP endpoint (HTTP + auth) will enable the ChatGPT Apps SDK without
  changing the core.
