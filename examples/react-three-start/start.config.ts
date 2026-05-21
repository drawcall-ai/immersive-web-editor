import editorPlugin, { type EditorFolderPath, type EditorSlotPath } from 'immersive-web-editor';
import { ai } from '@immersive-web-editor/ai';

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
const fieldsPath = [
  { id: 'editor-root', title: 'Editor', arrangement: 'dock-row' },
  { id: 'editor-side', title: 'Tools', arrangement: 'nav-top-icons', hideTitle: true, order: 30, size: 24 },
  { id: 'editor-fields', title: 'Fields', arrangement: 'accordion', defaultActive: true },
] as const satisfies EditorFolderPath;
const aiPath = [
  { id: 'editor-root', title: 'Editor', arrangement: 'dock-row' },
  { id: 'editor-side', title: 'Tools', arrangement: 'nav-top-icons', hideTitle: true, order: 30, size: 24 },
  { id: 'editor-chat', title: 'AI', arrangement: 'dropdown' },
] as const satisfies EditorFolderPath;

export default {
  injectCanvas: false,
  title: 'react-three-start Immersive Web Editor',
  vite: {
    plugins: [editorPlugin({
      previewPath,
      overlayPath,
      fieldsPath,
      plugins: [ai({ path: aiPath })],
    })],
    optimizeDeps: {
      noDiscovery: true,
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        '@react-three/fiber',
        'three',
        'immersive-web-editor',
        '@immersive-web-editor/adapter',
        'use-sync-external-store/shim/with-selector.js',
      ],
    },
  },
};
