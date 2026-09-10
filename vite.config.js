import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        workspace: resolve(__dirname, 'workspace.html'),
        map: resolve(__dirname, 'map.html'),
        platform: resolve(__dirname, 'platform.html'),
        layers: resolve(__dirname, 'layers.html'),
        intelligence: resolve(__dirname, 'intelligence.html'),
        enterprise: resolve(__dirname, 'enterprise.html'),
        login: resolve(__dirname, 'login.html'),
        solutions: resolve(__dirname, 'solutions.html')
      }
    }
  }
});
