import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  root: here,
  plugins: [react()],
  server: { fs: { allow: [root] } },
})
