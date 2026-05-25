# Custom Schemas

Create a schema when the AI needs a domain-specific control instead of a generic text/number/color/vector field.

## Pattern

```tsx
import { Slot } from '@immersive-web-editor/ui';
import { defineField, type Field } from 'immersive-web-editor';

const OPTIONS = ['calm', 'alert', 'hostile'] as const;
type Mood = (typeof OPTIONS)[number];

export function mood(defaultValue: Mood = 'alert'): Field<Mood> {
  return defineField<Mood>({
    defaultValue,
    component: ({ path, setValue, value }) => {
      "use editor";
      return (
        <Slot path={path}>
          {OPTIONS.map((option) => (
            <button key={option} type="button" onClick={() => setValue(option)}>
              {option}
            </button>
          ))}
        </Slot>
      );
    },
    props: { options: [...OPTIONS] },
  });
}
```

## Rules

- Return `defineField<T>()` from a small factory function.
- Keep `T`, `defaultValue`, and `props` JSON-compatible.
- Put `"use editor"` inside the component so the Vite transform extracts it.
- Render editor UI inside `<Slot path={path}>` unless the field delegates to another built-in field.
- Use `setValue(nextJsonValue)`; do not mutate objects in place.
- Export the schema from nearby app code when it is app-specific, or from the package only when it is generally useful.
