import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the app from /trading-studio/.
// In dev we keep the root so http://localhost:5173/ works as usual.
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/trading-studio/' : '/',
  plugins: [react()],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
}))
