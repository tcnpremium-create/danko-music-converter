# Danko Music Converter — MCP Server

An **isolated** [Model Context Protocol](https://modelcontextprotocol.io)
server that lets MCP-compatible assistants (Claude, ChatGPT via the Apps SDK)
use Danko Music Converter through a **small, scoped** set of tools.

The app runs fully without this server. This process is a separate capability
surface — **not** a gateway to your computer.

## Safety model (non-negotiable)

- **Scoped tools only.** Every tool maps to a Danko feature. There is **no**
  tool to run shell commands, read arbitrary files, or delete arbitrary
  folders.
- **Confirmation on destructive ops.** Tools marked destructive (e.g.
  `delete_tracks`) refuse unless called again with `"confirm": true`.
- **No file deletion on disk.** `delete_tracks` only removes *library entries*;
  it never deletes the user's audio files.
- **Honest results.** When the core isn't attached, read/action tools return
  `{ "ok": false, "reason": "core-not-connected" }` — they never fake success.

## Tools

| Tool | Kind | Description |
| --- | --- | --- |
| `search_library` | read | Search tracks by title/artist/album |
| `get_track_metadata` | read | Stored metadata for a track |
| `analyze_audio` | read | Duration, bitrate, sample rate, channels, format, size |
| `get_conversion_history` | read | Recent conversions |
| `list_presets` | read | Conversion presets (DJ MP3, High Quality, WAV Master, FLAC Archive, Custom) |
| `generate_report` | read | Library summary |
| `convert_audio` | action | Queue conversion to a format/preset (writes new files) |
| `update_metadata` | action | Update editable tags (no file deletion) |
| `delete_tracks` | **destructive** | Remove library entries — requires `confirm: true` |

## Run

```bash
cd mcp
npm run start        # stdio MCP server
npm run smoke        # verify the handshake, tool list and safety gates
```

## Connect to Claude (Claude Desktop / Code)

Add to your MCP client config (stdio transport):

```jsonc
{
  "mcpServers": {
    "danko-music-converter": {
      "command": "node",
      "args": ["/absolute/path/to/danko-music-converter/mcp/src/server.mjs"]
    }
  }
}
```

## Connect to ChatGPT (Apps SDK)

The same server can back a ChatGPT app. That path needs a **remote** transport
(HTTP) plus auth rather than stdio — tracked on the roadmap. The tool
definitions in `src/tools.mjs` are transport-agnostic and reused as-is.

## Wiring to the running app

`src/core.mjs` defines the `DankoCore` adapter — the only surface the server
may touch. Replace `createCore()` with an adapter that talks to the app
(local IPC/HTTP bridge) or opens the library SQLite file read-only for query
tools. Until then, action tools honestly report `core-not-connected`.
