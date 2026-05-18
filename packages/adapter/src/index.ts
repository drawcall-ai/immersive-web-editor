const SOURCE = '@immersive-web-editor/adapter';

export type CameraMatrix = readonly [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
export type CameraMatrixInput = CameraMatrix | ArrayLike<number>;
export type ReceivedEditorCamera = { submit(): void; dispose(): void };

export function publishEditorCamera(accept: (matrix: CameraMatrix) => void): () => void {
  const listener = (event: MessageEvent<unknown>) => {
    if (event.origin !== location.origin || !isCameraMessage(event.data)) return;
    accept(event.data.matrix);
  };
  window.addEventListener('message', listener);
  window.parent?.postMessage({ source: SOURCE, type: 'editor-camera:ready' }, location.origin);
  return () => window.removeEventListener('message', listener);
}

export function receiveEditorCamera(target: Window, camera: () => CameraMatrixInput): ReceivedEditorCamera {
  const submit = () => target.postMessage({
    source: SOURCE,
    type: 'editor-camera',
    matrix: matrix(camera()),
  }, location.origin);
  const listener = (event: MessageEvent<unknown>) => {
    if (event.origin === location.origin && event.source === target && isMessage(event.data, 'editor-camera:ready')) submit();
  };
  window.addEventListener('message', listener);
  submit();
  return { submit, dispose: () => window.removeEventListener('message', listener) };
}

function isCameraMessage(value: unknown): value is { matrix: CameraMatrix } {
  return isMessage(value, 'editor-camera') && isMatrix(value.matrix);
}

function matrix(value: CameraMatrixInput): CameraMatrix {
  if (!isMatrix(value)) throw new Error('Expected a 16-number camera matrix.');
  return Array.from(value) as unknown as CameraMatrix;
}

function isMatrix(value: unknown): value is CameraMatrixInput {
  return typeof value === 'object' && value !== null && 'length' in value && value.length === 16
    && Array.from(value as unknown as ArrayLike<unknown>).every((item) => typeof item === 'number');
}

function isMessage(value: unknown, type: string): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
    && 'source' in value && value.source === SOURCE
    && 'type' in value && value.type === type;
}
