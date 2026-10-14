# Proyecto: Danko Music Converter
- Ámbito: software musical (app de escritorio Electron local-first + servidor MCP)
- Repositorio: tcnpremium-create/danko-music-converter (público)
- Stack: Electron + Vite + TypeScript, ffmpeg, sql.js, servidor MCP (stdio/HTTP con express)
- Despliegue: Render Docker `danko-music-converter-mcp` (rama main, autodeploy, `DANKO_MCP_TOKEN` como secreto en el dashboard). Nunca tocar `main`.
- Comandos: `npm run typecheck`, `npm test` (vitest), `npm run build`, `npm run e2e`
- Política: ver `SECURITY.md` (sin telemetría, sin secretos en el repo, MCP acotado: sin herramientas de ejecución/lectura arbitraria).
- Sensibles: token MCP, OAuth Spotify (PKCE, sin client secret), cualquier ampliación de herramientas MCP.
