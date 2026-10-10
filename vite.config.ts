import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Vite root is `web/`, while the build output lands in `dist/` next to
// `server/` so that the production Express server can serve it directly.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200
  }
});
