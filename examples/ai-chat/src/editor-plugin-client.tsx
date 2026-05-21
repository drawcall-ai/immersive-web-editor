import { MoodFieldComponent } from './custom-field-components';
import type { EditorPluginApi } from 'virtual:editor/config';

export function activate(editor: EditorPluginApi): () => void {
  return editor.addFieldComponent('example.mood', MoodFieldComponent);
}
