import { publishEditorCamera, publishPreviewCanvasViewport } from '@immersive-web-editor/adapter';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { SRGBColorSpace, TextureLoader } from 'three';
import { color, config, fileUrl, number, optional, string, transform3D, val } from 'immersive-web-editor';

type Transform = {
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  scale: readonly [number, number, number];
};

function PreviewCameraSync() {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const disposeEditorCamera = publishEditorCamera((editorCamera) => {
      camera.matrixAutoUpdate = false;
      camera.matrix.fromArray(editorCamera.matrixWorld);
      camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
      camera.updateMatrixWorld(true);
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      camera.projectionMatrix.fromArray(editorCamera.projectionMatrix);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      invalidate();
    });
    const viewport = publishPreviewCanvasViewport(gl.domElement);
    return () => {
      disposeEditorCamera();
      viewport.dispose();
    };
  }, [camera, gl, invalidate]);

  return null;
}

function SceneMarker({
  color,
  mapTexture,
  transform,
}: {
  color: string;
  mapTexture?: string;
  transform: Transform;
}) {
  return (
    <group position={transform.position} rotation={transform.rotation} scale={transform.scale}>
      <mesh>
        <boxGeometry args={[0.46, 0.46, 0.46]} />
        {mapTexture ? (
          <CubeTextureMaterial color={color} fileName={mapTexture} />
        ) : (
          <meshStandardMaterial color={color} roughness={0.42} metalness={0.08} transparent opacity={0.58} />
        )}
      </mesh>
      <mesh>
        <sphereGeometry args={[0.07, 18, 18]} />
        <meshBasicMaterial color="#ff3158" />
      </mesh>
      <mesh position={[0, 0, -0.26]}>
        <boxGeometry args={[0.68, 0.68, 0.04]} />
        <meshBasicMaterial color="#111827" transparent opacity={0.42} />
      </mesh>
    </group>
  );
}

function CubeTextureMaterial({
  color,
  fileName,
}: {
  color: string;
  fileName: string;
}) {
  const texture = useLoader(TextureLoader, `/${encodeURIComponent(fileName)}`);

  useEffect(() => {
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
  }, [texture]);

  return (
    <meshStandardMaterial
      color={color}
      map={texture}
      roughness={0.42}
      metalness={0.08}
      transparent
      opacity={0.92}
    />
  );
}

export function App() {
  const object = config('Transform Handle', {
    name: val("Portal marker", string()),
    color: val("#00ff04", color()),
    mapTexture: val(null, optional({ item: fileUrl({ accept: "image/*", label: "Map texture" }) })),
    transform: val(
      {"position":[0,0,0],"rotation":[0,0,0],"scale":[1,1,1]},
      transform3D(),
    ),
    fov: val(45, number())
  });

  return (
    <main className="page">
      <section className="stage">
        <Canvas
          camera={{ position: [0, 0, 5], fov: object.fov }}
          key={object.fov}
          className="canvas"
          frameloop="demand"
        >
          <PreviewCameraSync />
          <color attach="background" args={['#07080d']} />
          <ambientLight intensity={0.72} />
          <directionalLight position={[3, 4, 5]} intensity={1.6} />
          <gridHelper args={[8, 8, '#475569', '#1e293b']} />
          <axesHelper args={[1.4]} />
          <SceneMarker color={object.color} mapTexture={object.mapTexture ?? undefined} transform={object.transform} />
        </Canvas>
        <div className="hud">
          <strong>{object.name}</strong>
          <span>{object.transform.position.map((part) => part.toFixed(2)).join(', ')}</span>
          {object.mapTexture && <span>{object.mapTexture}</span>}
        </div>
      </section>
    </main>
  );
}
