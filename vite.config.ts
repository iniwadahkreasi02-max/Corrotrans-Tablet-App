import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
const port = Number(process.env.PORT ?? 5173);
if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('Invalid PORT');
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src'), '@assets': path.resolve(import.meta.dirname, 'src/assets') }, dedupe: ['react', 'react-dom'] },
  server: { host: '0.0.0.0', port, strictPort: true, allowedHosts: true },
  preview: { host: '0.0.0.0', port, allowedHosts: true },
  build: { outDir: path.resolve(import.meta.dirname, 'dist'), emptyOutDir: true },
});
