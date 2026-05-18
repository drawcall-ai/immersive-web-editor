import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import editorPlugin from 'immersive-web-editor';

export default defineConfig({
  plugins: [
    editorPlugin(),
    react(),
  ],
});
