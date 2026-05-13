import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import editorPlugin from 'immersive-web-editor';
import { ai } from '@immersive-web-editor/ai';

export default defineConfig({
  plugins: [
    editorPlugin({
      plugins: [ai()],
    }),
    react(),
  ],
});
