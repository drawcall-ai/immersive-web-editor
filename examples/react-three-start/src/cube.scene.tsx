import { color, config, number, transform3D, val } from 'immersive-web-editor';

const cubeTransform = config(
  'Cube Transform',
  val({"position":[10,0,10],"rotation":[0,0,0.22],"scale":[1.4,3.79,1.4]}, transform3D()),
);

const cubeColor = config('Cube Color', val("#ff0000", color()));

const cubeRoughness = config('Cube Roughness', val(0, number({ min: 0, max: 1, step: 0.01 })));

const cubeMetalness = config('Cube Metalness', val(0.08, number({ min: 0, max: 1, step: 0.01 })));

export default function Cube() {
  return (
    <mesh position={cubeTransform.position} rotation={cubeTransform.rotation} scale={cubeTransform.scale}>
      <boxGeometry />
      <meshStandardMaterial color={cubeColor} roughness={cubeRoughness} metalness={cubeMetalness} />
    </mesh>
  );
}
