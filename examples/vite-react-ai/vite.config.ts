import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import editorPlugin from '@iwe/vite-plugin';
import { aiChatPlugin } from '@iwe/ai-chat-plugin';

export default defineConfig({
  plugins: [
    editorPlugin({
      plugins: [aiChatPlugin()],
    }),
    react(),
  ],
});
