import {
  defineField,
  editorComponent,
  type Field,
  type JsonValue,
} from 'immersive-web-editor';

const MOODS = ['calm', 'alert', 'hostile'] as const;
type Mood = (typeof MOODS)[number];

export function mood(options: { default?: Mood } = {}): Field<Mood> {
  return defineField<Mood>({
    defaultValue: options.default ?? 'alert',
    component: editorComponent('./custom-field-components.tsx', 'MoodFieldComponent'),
    props: {
      options: [...MOODS] satisfies JsonValue,
    },
  });
}
