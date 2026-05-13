# API Rules

The purpose of `config()` is to turn code literals into visual controls that still sync back to source. When choosing what to expose, bias toward broad coverage of authored defaults and tuning knobs, then exclude values that are unsafe, non-JSON, derived, or too noisy.

## Imports

```ts
import { boolean, color, config, number, string, val, vec2, vec3 } from 'immersive-web-editor';
```

## Shapes

- `config(label, shape)` creates one panel.
- Nested object keys become nested editor paths.
- `val(value)` infers a basic field from JSON value type.
- `val(value, schema)` uses a specific field schema.
- Current values must be raw JSON literals in source: strings, numbers, booleans, null, arrays, and plain objects.

Good:

```ts
const ui = config('UI', {
  title: val('Hello'),
  enabled: val(true),
  offset: val([0, 12], vec2()),
});
```

Avoid:

```ts
val(Math.random());
val(new THREE.Vector3());
val(theme.primary);
val(() => doThing());
```

## Built-In Schemas

Use `string`, `number`, `boolean`, `color`, `vec2`, `vec3`, `position3D`, `rotation3D`, `scale3D`, `object`, `array`, `optional`, and `json`.

Use explicit schemas when the editor needs constraints, color pickers, vector controls, arrays, objects, or nullable values.
