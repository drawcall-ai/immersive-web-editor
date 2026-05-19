import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const tmpDir = new URL('../.test-tmp/', import.meta.url);
const bundledEntry = new URL('client-public.mjs', tmpDir);
const bundledServerEntry = new URL('server.mjs', tmpDir);

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
await build({
  entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  outfile: fileURLToPath(bundledServerEntry),
  packages: 'external',
  platform: 'node',
  target: 'es2022',
});

const { fileUrl, optional } = await import(bundledEntry.href);
const { default: editorPlugin } = await import(bundledServerEntry.href);

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

test('config transform registers final val property without trailing comma', () => {
  const plugin = editorPlugin();
  const source = `import { config, number, transform3D, val } from 'immersive-web-editor';
const object = config('Transform Handle', {
  transform: val({"position":[0,0,0],"rotation":[0,0,0],"scale":[1,1,1]}, transform3D()),
  fov: val(45, number())
});`;

  const result = plugin.transform(source, fileURLToPath(new URL('../examples/transform-handles/src/App.tsx', import.meta.url)));

  assert.match(result.code, /"path":\["fov"\]/);
  assert.match(result.code, /fov:\s*val\(\{"id":"editor:/);
});

test('custom field component references resolve relative modules for the editor', () => {
  const plugin = editorPlugin();
  const source = `import { config, defineField, editorComponent, val } from 'immersive-web-editor';
const custom = defineField({
  defaultValue: "hello",
  component: editorComponent('./custom-field-components.tsx', 'MoodFieldComponent'),
});
const object = config('Custom', {
  title: val("hello", custom)
});`;

  const file = fileURLToPath(new URL('../examples/vite-react-ai/src/custom-fields.tsx', import.meta.url));
  const result = plugin.transform(source, file);

  assert.match(result.code, /component:\s*\{"module":"\/@fs\/.*custom-field-components\.tsx","exportName":"MoodFieldComponent"\}/);
  assert.equal(result.code.includes('editorComponent('), false);
});
