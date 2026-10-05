# Danko Music Converter — MCP (Streamable HTTP) server image.
# Hosts the remote /mcp endpoint. FFmpeg is provided by ffmpeg-static (npm),
# so no system ffmpeg is required.
FROM node:20-slim

WORKDIR /app

# The MCP server runs on plain Node: don't download the Electron binary.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

# Install only prod deps for a smaller image; dev deps (esbuild) are needed to
# build the MCP bundle, so build in a first stage then prune.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build:mcp && npm prune --omit=dev

ENV NODE_ENV=production
# Cloud platforms route to $PORT and require binding 0.0.0.0.
ENV DANKO_MCP_HOST=0.0.0.0
EXPOSE 8787

# DANKO_MCP_TOKEN should be set as a secret in the platform dashboard.
CMD ["node", "dist/mcp/http.mjs"]
