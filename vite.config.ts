import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@core': r('./src/core'),
      '@species': r('./src/species'),
      '@app': r('./src/app'),
      '@platform': r('./src/platform'),
    },
  },
  server: {
    host: true, // 触摸显示器 / 平板通过局域网访问时需要
    port: 5173,
  },
  build: {
    target: 'es2022',
    // 像素风：不做无意义的体积优化之外的处理
    assetsInlineLimit: 0,
  },
});
