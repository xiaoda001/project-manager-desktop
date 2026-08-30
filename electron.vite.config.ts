import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { join } from 'node:path'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    publicDir: join(__dirname, 'resources'),
    plugins: [react()]
  }
})
