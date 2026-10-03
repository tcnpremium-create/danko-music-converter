# Danko MCP — Claude & ChatGPT

One MCP server, one toolset, two transports. The same scoped tools serve every
MCP-compatible client. The server connects to the **real** Danko core (library
+ FFmpeg), never to a shell or arbitrary filesystem.

```
        ChatGPT            Claude
            \               /
             \             /
          Streamable HTTP / stdio
                   │
              DANKO MCP  (src/mcp, one toolset)
                   │
              DANKO CORE (AppService)
          ┌────────┼─────────┐
       LIBRARY   FFmpeg    METADATA
```

## Tools (all real, connected to the core)

| Tool | Kind | What it does |
| --- | --- | --- |
| `search_library` | read | Search tracks (query/artist/title/genre/year/format/folder/duration; bpm filter when known) |
| `get_track_metadata` | read | Stored metadata + technical fields |
| `analyze_audio` | read | Duration, container, codec, bitrate, sample rate, channels, size, **BPM + musical key + Camelot** (real DSP, cached) |
| `convert_audio` | action | Real FFmpeg conversion to a format/preset (writes new files) |
| `get_conversion_history` | read | Real conversion history |
| `list_presets` | read | DJ presets: MP3 320, High Quality, WAV, DJ WAV, FLAC, Streaming AAC |
| `generate_report` | read | Library stats + formats breakdown |
| `update_metadata` | protected | Edit tags — requires `confirm: true` |
| `delete_tracks` | **destructive** | Remove library entries — requires `confirm: true` (never deletes disk files) |

## Run it

```bash
npm install
npm run build:mcp

# stdio (Claude Desktop / local dev)
node dist/mcp/stdio.mjs

# Streamable HTTP (remote clients, e.g. ChatGPT) — Local Bridge by default
DANKO_MCP_TOKEN=yourtoken node dist/mcp/http.mjs
# -> http://127.0.0.1:8787/mcp   (health: /health)
```

Environment (all optional): `DANKO_DB_PATH`, `DANKO_OUTPUT_DIR`, `DANKO_WORK_DIR`,
`DANKO_DATA_DIR`, `PORT`/`DANKO_MCP_PORT`, `DANKO_MCP_HOST`, `DANKO_MCP_TOKEN`.

## Connect to Claude (stdio)

Claude Desktop/Code MCP config:

```jsonc
{
  "mcpServers": {
    "danko-music-converter": {
      "command": "node",
      "args": ["/abs/path/to/danko-music-converter/dist/mcp/stdio.mjs"],
      "env": { "DANKO_DB_PATH": "/abs/path/to/danko.sqlite" }
    }
  }
}
```

## Connect to ChatGPT (remote MCP / Apps SDK)

ChatGPT connects to a **remote** MCP over HTTPS. Two supported paths:

1. **Local Bridge + tunnel (recommended, local-first).** Keep your library on
   your machine: run the HTTP server locally and expose it with a secure
   tunnel, so only authorized tool calls cross the network — never your audio.

   ```bash
   DANKO_MCP_TOKEN=yourtoken node dist/mcp/http.mjs      # 127.0.0.1:8787
   cloudflared tunnel --url http://127.0.0.1:8787        # -> https://<sub>.trycloudflare.com
   ```

   In ChatGPT (Settings → Connectors → add MCP server), use:
   - URL: `https://<your-tunnel-host>/mcp`
   - Auth: Bearer token = your `DANKO_MCP_TOKEN`

2. **Hosted instance.** Deploy the Docker image (see [DEPLOY.md](./DEPLOY.md))
   for a public HTTPS `/mcp`. Point it at a library the server can read.

> The exact UI to add a connector/app in ChatGPT is controlled by OpenAI and may
> require enabling developer/connector features on your account. The server side
> (endpoint, transport, auth) is fully prepared; adding it in ChatGPT is the one
> manual step.

## Safety model

- Scoped tools only — no shell, no arbitrary file/command/delete tools.
- Destructive/protected tools require `confirm: true`.
- `delete_tracks` removes only **library entries**, never files on disk.
- Bearer auth on the HTTP transport; bind loopback as a Local Bridge.
- Honest results: unavailable analysis is `null`, never invented.
