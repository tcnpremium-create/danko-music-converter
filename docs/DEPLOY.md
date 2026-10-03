# Deploying the Danko MCP HTTP server

The remote MCP endpoint is a small Node HTTP server (`dist/mcp/http.mjs`). It
needs no database service — it uses local SQLite + bundled FFmpeg. Host it
anywhere that gives you **HTTPS** and a `$PORT`.

## Health & endpoints

- `GET /health` → `{ "status": "ok" }` (use as the platform health check)
- `POST /mcp` → JSON-RPC 2.0 (Streamable HTTP)

## Required/!useful env vars

| Var | Purpose |
| --- | --- |
| `DANKO_MCP_TOKEN` | Bearer token required on `/mcp` (set as a secret) |
| `DANKO_MCP_HOST` | `0.0.0.0` for cloud platforms |
| `PORT` | Port to bind (most platforms inject this) |
| `DANKO_DB_PATH` | Library DB path (optional) |
| `DANKO_OUTPUT_DIR` | Where conversions are written (optional) |

## Option A — Render (free, included config)

`render.yaml` is already in the repo (Docker runtime, free plan, health check
`/health`). Steps:

1. Push the repo to GitHub.
2. Render → New → Blueprint → pick this repo.
3. Set `DANKO_MCP_TOKEN` (secret) in the dashboard.
4. Deploy → you get `https://<name>.onrender.com` → endpoint `…/mcp`.

## Option B — Docker anywhere (Fly.io, Railway, a VPS)

```bash
docker build -t danko-mcp .
docker run -p 8787:8787 -e DANKO_MCP_HOST=0.0.0.0 -e DANKO_MCP_TOKEN=yourtoken danko-mcp
```

Put it behind any HTTPS reverse proxy (Caddy/Traefik/Nginx) or the platform's
managed TLS.

## Option C — Local Bridge + tunnel (recommended for personal libraries)

Keep audio on your machine; expose only authorized tool calls:

```bash
DANKO_MCP_TOKEN=yourtoken node dist/mcp/http.mjs      # binds 127.0.0.1:8787
cloudflared tunnel --url http://127.0.0.1:8787        # free HTTPS URL
```

Use the tunnel's `https://…/mcp` URL + bearer token in ChatGPT/Claude.

## Notes

- Free tiers may cold-start; the first request can be slow.
- Conversions run on the host that runs the server. For a personal library,
  prefer Option C so files never leave your machine.
