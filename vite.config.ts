import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('v12'),
    __APP_BUILD_STAMP__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react()],
});
