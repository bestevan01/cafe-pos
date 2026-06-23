import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// noinspection JSCheckFunctionSignatures,JSUnusedGlobalSymbols -- Vite 8(Rolldown) 타입 스텁이 함수형 manualChunks를 완전히 반영하지 못해 생기는 오탐(빌드는 정상, vendor 청크 생성됨)
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: [
      "miranda-unurging-creatively.ngrok-free.dev"
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'ws://localhost:8080',
        ws: true,
        changeOrigin: true,
      }
    }
  },

  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        }
      }
    }
  }
})