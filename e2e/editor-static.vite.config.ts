import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import editorPlugin from 'immersive-web-editor';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(here, '../packages/editor/src/editor'),
  plugins: [
    editorPlugin({
      build: {
        enabled: true,
        previewUrl: process.env.E2E_PREVIEW_URL ?? '/',
      },
    }),
  ],
});
