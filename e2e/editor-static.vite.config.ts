import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import editorPlugin from '../packages/editor/src/plugin/index';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, 'fixtures/vite-app');

export default defineConfig({
  root: resolve(here, '../packages/editor/src/editor'),
  plugins: [
    editorPlugin({
      build: {
        enabled: true,
        previewUrl: process.env.E2E_PREVIEW_URL ?? '/',
      },
      plugins: [
        {
          name: 'e2e-fields',
          client: resolve(fixtureRoot, 'src/editor-plugin-client.ts'),
        },
      ],
    }),
  ],
});
