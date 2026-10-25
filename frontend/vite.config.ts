import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  build: {
    rollupOptions: {
      output: {
        // React, роутер и TanStack Query меняются реже кода экранов — отдельной частью, она дольше живёт в кэше браузера.
        // Экраны грузятся по маршруту (React.lazy в src/App.tsx), recharts — вместе с экранами, где есть графики.
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|scheduler|react-router|@tanstack)\//.test(id)) return 'react'
        },
      },
    },
  },
})
