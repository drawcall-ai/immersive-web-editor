<p align="center">
  <img src="./docs/assets/immersive-web-editor-logo.png" width="160" alt="Immersive Web Editor logo" />
</p>

<h1 align="center">immersive-web-editor</h1>

<h3 align="center">Visual editing for Vite apps, synced back to code.</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/immersive-web-editor"><img src="https://img.shields.io/npm/v/immersive-web-editor?style=flat-square" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/Vite-plugin-646CFF?style=flat-square" alt="Vite plugin" />
  <img src="https://img.shields.io/badge/TypeScript-ready-3178C6?style=flat-square" alt="TypeScript ready" />
</p>

Immersive Web Editor turns authored values into visual controls. It is especially useful for React Three Fiber and vanilla Three.js scenes, where camera, light, transform, material, animation, and layout values are much easier to tune visually than by editing literals.

## Example

Group related values, then spread them into the props they drive.

```tsx
import { color, config, number, transform3D, val } from 'immersive-web-editor';

function Hero() {
  const hero = config('Hero', {
    mesh: {
      visible: val(true),
      transform: val({"position":[0,1,0],"rotation":[0,0,0],"scale":[1,1,1]}, transform3D()),
    },
    material: {
      color: val('#ff7755', color()),
      roughness: val(0.45, number({ default: 0.45, min: 0, max: 1, step: 0.01 })),
    },
  });

  return (
    <mesh visible={hero.mesh.visible} {...hero.mesh.transform}>
      <boxGeometry />
      <meshStandardMaterial {...hero.material} />
    </mesh>
  );
}
```

Edits made in the visual editor update the matching `val(...)` literals in your source.

## Install

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import editorPlugin from 'immersive-web-editor';

export default defineConfig({
  plugins: [editorPlugin()],
});
```

Run Vite and open `/editor`.

## What to expose

Expose as much authored state as is reasonable: camera defaults, light settings, mesh transforms, material values, layout numbers, labels, toggles, spawn points, animation constants, physics constants, and postprocessing knobs.

Keep values JSON-shaped. Avoid derived values, frame-by-frame state, secrets, callbacks, loaded assets, class instances, and library objects such as `THREE.Vector3`.

## Custom schemas

Use built-in schemas like `number`, `color`, `position3D`, and `transform3D` first. Create a schema with `defineField()` when a domain-specific control is worth it.

Built-in schema options live in one object:

```ts
number({ default: 0.5, min: 0, max: 1, step: 0.01 });
optional({ item: string({ default: 'Untitled' }) });
array({ item: object({ shape: { label: string() } }), itemLabel: 'Item' });
```
