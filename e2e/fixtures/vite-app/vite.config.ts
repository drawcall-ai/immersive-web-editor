import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import editorPlugin from 'immersive-web-editor';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [
    editorPlugin({
      plugins: [
        {
          name: 'e2e-fields',
          client: resolve(here, 'src/editor-plugin-client.ts'),
        },
      ],
    }),
  ],
});
