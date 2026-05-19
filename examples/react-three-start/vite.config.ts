import { defineConfig } from 'vite';
import editorPlugin, { type EditorFolderPath, type EditorSlotPath } from 'immersive-web-editor';

const previewPath = [
  { id: 'editor-root', title: 'Editor', arrangement: 'dock-row' },
  { id: 'editor-preview', title: 'Preview', arrangement: 'layer-stack', hideTitle: true, order: 20, size: 52 },
  { id: 'editor-preview-frame', title: 'Preview Frame', fill: true, interactive: true, order: 0, unstyled: true },
] as const satisfies EditorSlotPath;
const overlayPath = [
  { id: 'editor-root', title: 'Editor', arrangement: 'dock-row' },
  { id: 'editor-preview', title: 'Preview', arrangement: 'layer-stack', hideTitle: true, order: 20, size: 52 },
  { id: 'editor-preview-overlay', title: 'Overlay Canvas', fill: true, interactive: true, order: 10, unstyled: true },
] as const satisfies EditorSlotPath;
const configPath = [
  { id: 'editor-root', title: 'Editor', arrangement: 'dock-row' },
  { id: 'editor-config', title: 'Config', arrangement: 'accordion', hideTitle: true, order: 30, size: 24 },
] as const satisfies EditorFolderPath;

export default defineConfig({
  plugins: [editorPlugin({
    previewPath,
    overlayPath,
    configPath,
  })],
});
