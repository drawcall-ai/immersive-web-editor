import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const tmpDir = new URL('../.test-tmp/', import.meta.url);
const bundledEntry = new URL('client-public.mjs', tmpDir);

await rm(tmpDir, { recursive: true, force: true });
await mkdir(tmpDir, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('../src/client-public.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  outfile: fileURLToPath(bundledEntry),
  platform: 'browser',
  target: 'es2022',
});

const { fileUrl, optional } = await import(bundledEntry.href);

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

test('fileUrl has no built-in no-file option', () => {
  const source = readFileSync(new URL('../src/default-schema-components.tsx', import.meta.url), 'utf8');

  assert.equal(source.includes('No file'), false);
  assert.equal(source.includes('Upload a file'), true);
});

test('client public bundle excludes editor-only UI code', () => {
  const source = readFileSync(bundledEntry, 'utf8');

  assert.equal(source.includes('OverlayCanvasPortal'), false);
  assert.equal(source.includes('__editor/public-files'), false);
  assert.equal(source.includes('@immersive-web-editor/ui'), false);
  assert.equal(source.includes('@react-three/fiber'), false);
  assert.equal(source.includes('lucide-react'), false);
  assert.equal(source.includes('editor-shell'), false);
  assert.equal(source.includes('editor:removeField'), false);
  assert.equal(source.includes('global' + 'This'), false);
});

test('fileUrl can be declared without a default file', () => {
  const field = fileUrl({ accept: 'image/*', label: 'Texture' });

  assert.equal(field.defaultValue(), '');
  assert.equal(field.descriptor.label, 'Texture');
});

test('optional({ item: fileUrl() }) represents no public file as null', () => {
  const required = fileUrl();
  const nullable = optional({ item: required });

  assert.equal(required.defaultValue(), '');
  assert.equal(nullable.defaultValue(), null);
  assert.equal(nullable.descriptor.defaultValue, null);
});
