import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import editorPlugin, { type EditorFolderPath } from 'immersive-web-editor';
import { ai } from '@immersive-web-editor/ai';

const aiPath = [
  { id: 'editor-root', title: 'Editor', arrangement: 'dock-row' },
  { id: 'editor-chat', title: 'Chat', arrangement: 'dropdown', hideTitle: true, order: 10, size: 24 },
] as const satisfies EditorFolderPath;

export default defineConfig({
  plugins: [
    editorPlugin({
      plugins: [ai({ path: aiPath })],
    }),
    react(),
  ],
});
