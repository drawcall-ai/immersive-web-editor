import { defineConfig } from 'vite';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import editorPlugin from 'immersive-web-editor';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [
    editorPlugin(),
  ],
});
