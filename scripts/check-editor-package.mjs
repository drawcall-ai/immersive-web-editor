import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const packageDir = new URL('../packages/immersive-web-editor/', import.meta.url);
const { default: editorPlugin } = await import(new URL('dist/index.js', packageDir));
const plugin = editorPlugin();
const editorUiModule = plugin.load('\0virtual:editor/ui');

if (typeof editorUiModule !== 'string' || !editorUiModule.includes('/src/ui/entry.tsx')) {
  throw new Error('dist/index.js must prefer the source editor entry when src is present.');
}

const packJson = execFileSync('npm', ['pack', '--dry-run', '--json'], {
  cwd: packageDir,
  encoding: 'utf8',
});
const [pack] = JSON.parse(packJson);
const files = new Set(pack.files.map((file) => file.path));

for (const file of [
  'dist/index.js',
  'dist/plugin/index.js',
  'dist/authoring-api.js',
  'dist/ui/editor-ui.js',
  'dist/ui/entry.js',
  'dist/ui/palette.js',
  'dist/ui/styles.js',
]) {
  if (!files.has(file)) {
    throw new Error(`Package tarball is missing ${file}.`);
  }
}

console.log(`checked ${join('packages', 'immersive-web-editor')} package editor UI files`);
