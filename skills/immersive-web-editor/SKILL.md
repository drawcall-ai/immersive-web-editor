---
name: immersive-web-editor
description: Add immersive-web-editor editable fields to Vite apps so users can visually edit app and scene parameters through a simple editor UI that syncs changes back to source code. Use when Codex should install the Vite plugin, expose as much reasonable state as possible with config() and val(), choose editable parameters, or create custom field schemas for React Three Fiber, vanilla Three.js, or similar browser-rendered experiences.
---

# Immersive Web Editor

Immersive Web Editor gives users a simple visual editing UX while keeping code as the source of truth. It is especially useful for 3D apps, where camera, lighting, transform, material, animation, and layout values are hard to tune by editing literals.

Use this skill to expose as much reasonable authored state as possible through `config()` so the user can edit visually and have those edits sync back to code.

## AI Workflow

1. If the app has no editor plugin, edit `vite.config.ts` and add `editorPlugin()` from `immersive-web-editor`.
2. Find authored values that should be tuned live: scene defaults, camera/light/material settings, mesh transforms, UI constants, toggles, labels, arrays of sample objects, animation constants, physics constants, and postprocessing parameters.
3. Import `config`, `val`, and schemas from `immersive-web-editor`.
4. Add `config(label, shape)` close to the code that consumes the values.
5. Wrap editable leaves in `val(rawJsonLiteral, optionalSchema)`.
6. Create a custom schema only when built-in schemas cannot express the control.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import editorPlugin from 'immersive-web-editor';

export default defineConfig({
  plugins: [editorPlugin()],
});
```

Stop at code changes and validation; opening `/editor` is outside the AI task.

## `config()` Pattern

```tsx
import { color, config, number, position3D, val } from 'immersive-web-editor';

const scene = config('Scene', {
  background: val('#101014', color()),
  exposure: val(1, number(1, { min: 0, max: 2, step: 0.01 })),
  camera: { position: val([0, 2, 8], position3D()) },
});
```

Prefer broad but tidy coverage: several small, named panels are better than one overloaded panel or a few hidden magic literals. Keep values JSON-shaped. Do not wrap derived values, frame-by-frame state, secrets, user data, callbacks, class instances, loaded assets, or library objects.

## References

- React Three Fiber: read [r3f.md](references/r3f.md).
- Vanilla Three.js: read [vanilla-three.md](references/vanilla-three.md).
- API rules: read [api-rules.md](references/api-rules.md).
- Custom schemas: read [schemas.md](references/schemas.md).
