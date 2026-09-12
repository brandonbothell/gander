import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

console.log(__dirname)

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  ...(mode === 'development'
    ? {
        build: { manifest: true, sourcemap: true },
      }
    : {}),
}))
