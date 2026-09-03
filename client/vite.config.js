import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    // 개발 중 API를 백엔드로 넘긴다. 쿠키가 프록시를 통과하므로 동일 출처처럼 동작한다.
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } },
  },
});
