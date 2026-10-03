// Bundles the MCP servers (stdio + Streamable HTTP) with esbuild (ESM).
// Same strategy as build-main: packages external, loaded from node_modules at
// runtime. Outputs dist/mcp/{stdio,http}.mjs — runnable with `node`.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('dist/mcp', { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  packages: 'external',
  logLevel: 'info',
};

await build({ ...common, entryPoints: ['src/mcp/stdio.ts'], outfile: 'dist/mcp/stdio.mjs' });
await build({ ...common, entryPoints: ['src/mcp/http.ts'], outfile: 'dist/mcp/http.mjs' });

console.log('✓ MCP stdio + http compilados en dist/mcp');
