import React from 'react';
import { createRoot } from 'react-dom/client';
import type { EditorFieldComponent } from 'immersive-web-editor';

const MOODS = ['calm', 'alert', 'hostile'] as const;

function moodOptions(props: unknown): string[] {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return [...MOODS];
  const options = (props as { options?: unknown }).options;
  if (!Array.isArray(options)) return [...MOODS];
  const filtered = options.filter((option): option is string => typeof option === 'string');
  return filtered.length > 0 ? filtered : [...MOODS];
}

const MoodFieldComponent: EditorFieldComponent = ({ field, setValue, value }) => React.createElement(
  'div',
  { className: 'e2e-mood-field' },
  moodOptions(field.props).map((option) => React.createElement(
    'button',
    {
      'aria-pressed': value === option,
      key: option,
      type: 'button',
      onClick: () => void setValue(option),
    },
    option,
  )),
);

function PluginPanel({ count }: { count: number }) {
  return React.createElement(
    'div',
    { className: 'e2e-plugin-panel' },
    React.createElement('span', { 'data-testid': 'plugin-command-count' }, `Command count: ${count}`),
  );
}

export function activate(editor: any): () => void {
  let count = 0;
  let root: ReturnType<typeof createRoot> | null = null;
  const cleanupMood = editor.addFieldComponent('e2e.mood', MoodFieldComponent);
  const cleanupPanel = editor.addField({
    id: 'e2e:inspector',
    title: 'Inspector',
    mount(container: HTMLElement) {
      root = createRoot(container);
      root.render(React.createElement(PluginPanel, { count }));
      return () => {
        root?.unmount();
        root = null;
      };
    },
  });
  const cleanupCommand = editor.addCommand({
    id: 'e2e.inspector.increment',
    title: 'Inspector: increment counter',
    hint: 'test',
    run() {
      count += 1;
      root?.render(React.createElement(PluginPanel, { count }));
    },
  });

  return () => {
    cleanupCommand();
    cleanupPanel();
    cleanupMood();
  };
}
