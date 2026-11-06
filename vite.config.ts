import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    host: true,
    // In development the browser talks to Vite (3000); /api is forwarded to the Express server
    // started with `npm run dev:server`, so no API keys ever reach the browser.
    proxy: {
      '/api': { target: `http://localhost:${process.env.API_PORT ?? 8080}`, changeOrigin: true },
    },
  },
});
