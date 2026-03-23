import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('v4'),
    __APP_BUILD_STAMP__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('tesseract.js')) return 'vendor-tesseract';
          if (id.includes('@zxing/browser')) return 'vendor-zxing';
          if (id.includes('react-router-dom')) return 'vendor-router';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        },
      },
    },
  },
});
