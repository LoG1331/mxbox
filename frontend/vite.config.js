import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    minify: 'esbuild',
    cssMinify: true,
    sourcemap: false,
    target: 'es2020',
    reportCompressedSize: true,
  },
  server: {
    host: '127.0.0.1',
    port: 3002,
    strictPort: true,
    proxy: {
      '/health': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/v1': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
})
