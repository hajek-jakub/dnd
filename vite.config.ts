import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    // Na Endoře běží aplikace v kořeni subdomény (dnd.hajekjakub.cz).
    // Při nasazení do podsložky nastav VITE_BASE_PATH=/podslozka/.
    base: env.VITE_BASE_PATH || '/',
    plugins: [react(), tailwindcss()],
    // Verze buildu: uložená cache dat v prohlížeči (query-persist.ts) platí jen pro stejný build, po nasazení se zahodí.
    define: { __BUILD_ID__: JSON.stringify(String(Date.now())) },
    server: {
      // PHP API běží vedle (npm run api, port 8080). Stejný origin = stejné cookie jako na Endoře.
      proxy: {
        '/api': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8080' },
      },
    },
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  }
})
