# Vanilla Three.js

For vanilla Three.js, the goal is to expose scene setup and tuning constants to visual editing without storing Three.js instances in source-synced values. Use `config()` in the module or setup function that applies initial scene values. Convert JSON values into Three.js objects at the usage boundary.

```ts
import * as THREE from 'three';
import { color, config, number, position3D, val } from 'immersive-web-editor';

const settings = config('Scene', {
  background: val('#101014', color()),
  camera: { position: val([0, 2, 8], position3D()) },
  light: {
    color: val('#ffffff', color()),
    intensity: val(2, number(2, { min: 0, max: 10, step: 0.1 })),
  },
});

scene.background = new THREE.Color(settings.background);
camera.position.fromArray(settings.camera.position);
light.color.set(settings.light.color);
light.intensity = settings.light.intensity;
```

Use arrays for vectors and colors as strings. Prefer exposing camera, controls targets, lights, transforms, material colors/numbers, fog/background values, animation constants, and renderer/postprocessing knobs. Re-apply settings in the render/update path only when the value should keep driving the object.

Avoid putting Three.js instances, textures, renderers, scenes, cameras, or controls directly in `val()`.
