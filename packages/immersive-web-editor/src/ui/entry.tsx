import { createRoot } from 'react-dom/client';
import { EditorUi } from './editor-ui';
import {
  fieldsPath,
  overlayPath,
  pluginCommands,
  pluginModules,
  previewPath,
  previewUrl,
} from 'virtual:editor/config';

const root = document.createElement('div');
root.id = '__editor_root__';
document.documentElement.style.width = '100%';
document.documentElement.style.height = '100%';
document.documentElement.style.margin = '0';
document.documentElement.style.padding = '0';
document.documentElement.style.overflow = 'hidden';
document.body.style.width = '100%';
document.body.style.height = '100%';
document.body.style.margin = '0';
document.body.style.padding = '0';
document.body.style.overflow = 'hidden';
root.style.width = '100%';
root.style.height = '100%';
root.style.overflow = 'hidden';
document.body.appendChild(root);
createRoot(root).render(
  <EditorUi
    fieldsPath={fieldsPath}
    overlayPath={overlayPath}
    pluginCommands={pluginCommands}
    pluginModules={pluginModules}
    previewPath={previewPath}
    previewUrl={previewUrl || '/'}
  />,
);
