import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import editorPlugin from 'immersive-web-editor';
import { ai } from '@iwe/ai';

export default defineConfig({
  plugins: [
    editorPlugin({
      plugins: [ai()],
    }),
    react(),
  ],
});
