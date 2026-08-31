import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/NEPAL-/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
})
