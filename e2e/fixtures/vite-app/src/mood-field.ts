import {
  defineField,
  type Field,
  type JsonValue,
} from 'immersive-web-editor';

const MOODS = ['calm', 'alert', 'hostile'] as const;
type Mood = (typeof MOODS)[number];

export function mood(options: { default?: Mood } = {}): Field<Mood> {
  return defineField<Mood>({
    defaultValue: options.default ?? 'calm',
    component: 'e2e.mood',
    props: {
      options: [...MOODS] satisfies JsonValue,
    },
  });
}
