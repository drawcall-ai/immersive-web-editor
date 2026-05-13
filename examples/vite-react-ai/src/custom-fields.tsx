import { Slot } from '@iwe/ui';
import {
  defineField,
  type Field,
  type JsonValue,
} from 'immersive-web-editor';

const MOODS = ['calm', 'alert', 'hostile'] as const;
type Mood = (typeof MOODS)[number];

function isMood(value: unknown): value is Mood {
  return typeof value === 'string' && (MOODS as readonly string[]).includes(value);
}

function moodOptions(props: unknown): Mood[] {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return [...MOODS];
  const options = (props as { options?: unknown }).options;
  if (!Array.isArray(options)) return [...MOODS];
  const filtered = options.filter(isMood);
  return filtered.length > 0 ? filtered : [...MOODS];
}

function MoodField({
  options,
  value,
  onChange,
}: {
  options: Mood[];
  value: Mood;
  onChange(value: Mood): void;
}) {
  return (
    <div className="example-mood-field">
      {options.map((option) => (
        <button
          data-active={option === value}
          key={option}
          type="button"
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function mood(defaultValue: Mood = 'alert'): Field<Mood> {
  return defineField<Mood>({
    defaultValue,
    component: ({ field, path, setValue, value }) => {
      "use editor";
      return (
        <Slot path={path}>
          <style>{`
            .example-mood-field {
              width: 100%;
              min-width: 0;
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              gap: 3px;
            }
            .example-mood-field button {
              min-width: 0;
              height: 26px;
              border: 1px solid var(--dc-border, #e4e4e7);
              border-radius: var(--dc-radius-sm, 4px);
              background: var(--dc-bg, #fff);
              color: var(--dc-fg-muted, #52525b);
              font: inherit;
              font-size: 11px;
              padding: 0 6px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              cursor: pointer;
            }
            .example-mood-field button:hover {
              background: var(--dc-bg-hover, #f4f4f5);
              color: var(--dc-fg, #09090b);
            }
            .example-mood-field button[data-active="true"] {
              background: var(--dc-accent, #09090b);
              border-color: var(--dc-accent, #09090b);
              color: #fff;
            }
          `}</style>
          <MoodField
            options={moodOptions(field.props)}
            value={isMood(value) ? value : 'alert'}
            onChange={(next) => void setValue(next)}
          />
        </Slot>
      );
    },
    props: {
      options: [...MOODS] satisfies JsonValue,
    },
  });
}
