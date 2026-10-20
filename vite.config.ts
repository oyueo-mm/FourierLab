import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Served from https://oyueo-mm.github.io/FourierLab/ (GitHub Pages project site).
  // dev and preview use the same base so path problems show up locally, not only after deploy.
  base: '/FourierLab/',
  plugins: [react(), tailwindcss()],
  // Recharts dominates the bundle; one chunk is acceptable for a single-page app.
  build: { chunkSizeWarningLimit: 800 },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
