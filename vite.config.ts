import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { join } from 'node:path'

export default defineConfig({
  root: join(__dirname, 'src/renderer'),
  publicDir: join(__dirname, 'resources'),
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true
  },
  build: {
    outDir: join(__dirname, 'dist'),
    emptyOutDir: true
  }
})
