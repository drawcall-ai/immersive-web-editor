import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const packageDir = new URL('../packages/immersive-web-editor/', import.meta.url);
const { default: editorPlugin } = await import(new URL('dist/index.js', packageDir));
const plugin = editorPlugin();
const shellModule = plugin.load('\0virtual:editor/shell');

if (typeof shellModule !== 'string' || !shellModule.includes('immersive-web-editor/editor-shell')) {
  throw new Error('dist/index.js must load the built editor shell.');
}

const packJson = execFileSync('npm', ['pack', '--dry-run', '--json'], {
  cwd: packageDir,
  encoding: 'utf8',
});
const [pack] = JSON.parse(packJson);
const files = new Set(pack.files.map((file) => file.path));

for (const file of [
  'dist/index.js',
  'dist/client/editor-shell.js',
  'dist/client/palette.js',
  'dist/client/styles.js',
]) {
  if (!files.has(file)) {
    throw new Error(`Package tarball is missing ${file}.`);
  }
}

console.log(`checked ${join('packages', 'immersive-web-editor')} package shell files`);
