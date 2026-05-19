const SOURCE = '@immersive-web-editor/adapter';

export type CameraMatrix = readonly [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
export type CameraMatrixInput = CameraMatrix | ArrayLike<number>;
export type EditorCamera = CameraMatrix & {
  matrixWorld: CameraMatrix;
  projectionMatrix: CameraMatrix;
};
export type EditorCameraInput = {
  matrixWorld: CameraMatrixInput;
  projectionMatrix: CameraMatrixInput;
};
export interface PreviewCanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface PreviewViewport {
  canvasRect: PreviewCanvasRect;
  devicePixelRatio: number;
}
export type ReceivedEditorCamera = { submit(): void; dispose(): void };
export type PublishedPreviewViewport = { submit(): void; dispose(): void };

export function publishEditorCamera(accept: (camera: EditorCamera) => void): () => void {
  const listener = (event: MessageEvent<unknown>) => {
    if (event.origin !== location.origin || !isCameraMessage(event.data)) return;
    accept(editorCamera(event.data.matrixWorld, event.data.projectionMatrix));
  };
  window.addEventListener('message', listener);
  window.parent?.postMessage({ source: SOURCE, type: 'editor-camera:ready' }, location.origin);
  return () => window.removeEventListener('message', listener);
}

export function receiveEditorCamera(target: Window, camera: () => EditorCameraInput): ReceivedEditorCamera {
  const submit = () => {
    const next = camera();
    const matrixWorld = matrix(next.matrixWorld);
    target.postMessage({
      source: SOURCE,
      type: 'editor-camera',
      matrix: matrixWorld,
      matrixWorld,
      projectionMatrix: matrix(next.projectionMatrix),
    }, location.origin);
  };
  const listener = (event: MessageEvent<unknown>) => {
    if (event.origin === location.origin && event.source === target && isMessage(event.data, 'editor-camera:ready')) submit();
  };
  window.addEventListener('message', listener);
  submit();
  return { submit, dispose: () => window.removeEventListener('message', listener) };
}

export function publishPreviewViewport(canvas: Element | (() => Element | null)): PublishedPreviewViewport {
  const getCanvas = typeof canvas === 'function' ? canvas : () => canvas;
  let disposed = false;
  let observed: Element | null = null;
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => submit());

  const submit = () => {
    if (disposed) return;
    const element = getCanvas();
    if (!element) return;
    if (observer && observed !== element) {
      if (observed) observer.unobserve(observed);
      observer.observe(element);
      observed = element;
    }
    const rect = element.getBoundingClientRect();
    window.parent?.postMessage({
      source: SOURCE,
      type: 'preview-viewport',
      canvasRect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      devicePixelRatio: window.devicePixelRatio || 1,
    }, location.origin);
  };

  const listener = (event: MessageEvent<unknown>) => {
    if (event.origin === location.origin && isMessage(event.data, 'preview-viewport:ready')) submit();
  };

  window.addEventListener('message', listener);
  window.addEventListener('resize', submit);
  window.addEventListener('scroll', submit, true);
  window.visualViewport?.addEventListener('resize', submit);
  window.visualViewport?.addEventListener('scroll', submit);
  requestAnimationFrame(submit);

  return {
    submit,
    dispose() {
      disposed = true;
      window.removeEventListener('message', listener);
      window.removeEventListener('resize', submit);
      window.removeEventListener('scroll', submit, true);
      window.visualViewport?.removeEventListener('resize', submit);
      window.visualViewport?.removeEventListener('scroll', submit);
      observer?.disconnect();
    },
  };
}

export function receivePreviewViewport(target: Window, accept: (viewport: PreviewViewport) => void): () => void {
  const listener = (event: MessageEvent<unknown>) => {
    if (event.origin !== location.origin || event.source !== target || !isPreviewViewportMessage(event.data)) return;
    accept(event.data);
  };
  window.addEventListener('message', listener);
  target.postMessage({ source: SOURCE, type: 'preview-viewport:ready' }, location.origin);
  return () => window.removeEventListener('message', listener);
}

function isCameraMessage(value: unknown): value is { matrixWorld: CameraMatrix; projectionMatrix: CameraMatrix } {
  return isMessage(value, 'editor-camera') && isMatrix(value.matrixWorld) && isMatrix(value.projectionMatrix);
}

function isPreviewViewportMessage(value: unknown): value is PreviewViewport {
  return isMessage(value, 'preview-viewport')
    && typeof value.devicePixelRatio === 'number'
    && Number.isFinite(value.devicePixelRatio)
    && isCanvasRect(value.canvasRect);
}

function isCanvasRect(value: unknown): value is PreviewCanvasRect {
  return typeof value === 'object' && value !== null
    && 'left' in value && typeof value.left === 'number' && Number.isFinite(value.left)
    && 'top' in value && typeof value.top === 'number' && Number.isFinite(value.top)
    && 'width' in value && typeof value.width === 'number' && Number.isFinite(value.width)
    && 'height' in value && typeof value.height === 'number' && Number.isFinite(value.height);
}

function matrix(value: CameraMatrixInput): CameraMatrix {
  if (!isMatrix(value)) throw new Error('Expected a 16-number camera matrix.');
  return Array.from(value) as unknown as CameraMatrix;
}

function editorCamera(matrixWorldInput: CameraMatrixInput, projectionMatrixInput: CameraMatrixInput): EditorCamera {
  const matrixWorld = matrix(matrixWorldInput);
  const projectionMatrix = matrix(projectionMatrixInput);
  const camera = Array.from(matrixWorld) as unknown as EditorCamera;
  camera.matrixWorld = matrixWorld;
  camera.projectionMatrix = projectionMatrix;
  return camera;
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
