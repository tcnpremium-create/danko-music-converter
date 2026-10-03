import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Renderer (React UI). Main/preload se compilan con esbuild (scripts/build-main.mjs).
export default defineConfig({
  root: 'src',
  base: './',
  plugins: [react()],
  build: { outDir: '../dist/renderer', emptyOutDir: true },
  server: { port: 5173, strictPort: true },
});
