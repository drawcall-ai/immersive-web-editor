# React Three Fiber

For React Three Fiber, the goal is to make most authored scene parameters visually editable while preserving source-code sync. Place `config()` inside the component that owns the tunable scene values. Pass plain arrays and primitives into R3F props; do not store `THREE.Vector3`, materials, or refs in `val()`.

```tsx
import { color, config, number, position3D, rotation3D, scale3D, val } from 'immersive-web-editor';

function HeroMesh() {
  const hero = config('Hero', {
    visible: val(true),
    position: val([0, 1, 0], position3D()),
    rotation: val([0, 0, 0], rotation3D()),
    scale: val([1, 1, 1], scale3D()),
    material: {
      color: val('#ff7755', color()),
      roughness: val(0.45, number(0.45, { min: 0, max: 1, step: 0.01 })),
    },
  });

  return (
    <mesh visible={hero.visible} position={hero.position} rotation={hero.rotation} scale={hero.scale}>
      <boxGeometry />
      <meshStandardMaterial color={hero.material.color} roughness={hero.material.roughness} />
    </mesh>
  );
}
```

Use `config()` generously for camera starting positions, light intensity/color, mesh transforms, material values, primitive dimensions, physics constants, animation timings, spawn points, and postprocessing parameters.

Avoid `config()` for `useFrame` results, refs, loaders, geometries, materials as objects, and values produced every render from other state.
