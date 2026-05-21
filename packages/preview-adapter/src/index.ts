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
export interface PreviewCanvasViewport {
  canvasRect: PreviewCanvasRect;
  devicePixelRatio: number;
}
export type ReceivedEditorCamera = { submit(): void; dispose(): void };
export type PublishedPreviewCanvasViewport = { submit(): void; dispose(): void };
export type PreviewViewport = PreviewCanvasViewport;
export type PublishedPreviewViewport = PublishedPreviewCanvasViewport;

export interface EditorOriginOptions {
  editorOrigin?: string;
}

export interface PreviewOriginOptions {
  previewOrigin?: string;
}

export function publishEditorCamera(accept: (camera: EditorCamera) => void, options: EditorOriginOptions = {}): () => void {
  const targetOrigin = options.editorOrigin ?? parentEditorOrigin();
  const listener = (event: MessageEvent<unknown>) => {
    if (event.origin !== targetOrigin || !isCameraMessage(event.data)) return;
    accept(editorCamera(event.data.matrixWorld, event.data.projectionMatrix));
  };
  window.addEventListener('message', listener);
  safePostMessage(window.parent, { source: SOURCE, type: 'editor-camera:ready' }, targetOrigin);
  return () => window.removeEventListener('message', listener);
}

export function receiveEditorCamera(target: Window, camera: () => EditorCameraInput, options: PreviewOriginOptions = {}): ReceivedEditorCamera {
  const targetOrigin = options.previewOrigin ?? location.origin;
  const submit = () => {
    const next = camera();
    const matrixWorld = matrix(next.matrixWorld);
    safePostMessage(target, {
      source: SOURCE,
      type: 'editor-camera',
      matrix: matrixWorld,
      matrixWorld,
      projectionMatrix: matrix(next.projectionMatrix),
    }, targetOrigin);
  };
  const listener = (event: MessageEvent<unknown>) => {
    if (event.origin !== targetOrigin || event.source !== target || !isMessage(event.data, 'editor-camera:ready')) return;
    submit();
  };
  window.addEventListener('message', listener);
  return { submit, dispose: () => window.removeEventListener('message', listener) };
}

export function publishPreviewCanvasViewport(previewCanvas: Element | (() => Element | null), options: EditorOriginOptions = {}): PublishedPreviewCanvasViewport {
  const targetOrigin = options.editorOrigin ?? parentEditorOrigin();
  const getPreviewCanvas = typeof previewCanvas === 'function' ? previewCanvas : () => previewCanvas;
  let disposed = false;
  let observed: Element | null = null;
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => submit());

  const submit = () => {
    if (disposed) return;
    const element = getPreviewCanvas();
    if (!element) return;
    if (observer && observed !== element) {
      if (observed) observer.unobserve(observed);
      observer.observe(element);
      observed = element;
    }
    const rect = element.getBoundingClientRect();
    safePostMessage(window.parent, {
      source: SOURCE,
      type: 'preview-canvas-viewport',
      canvasRect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      devicePixelRatio: window.devicePixelRatio || 1,
    }, targetOrigin);
  };

  const listener = (event: MessageEvent<unknown>) => {
    if (event.origin === targetOrigin && isMessage(event.data, 'preview-canvas-viewport:ready')) submit();
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

export function receivePreviewCanvasViewport(target: Window, accept: (viewport: PreviewCanvasViewport) => void, options: PreviewOriginOptions = {}): () => void {
  const targetOrigin = options.previewOrigin ?? location.origin;
  const listener = (event: MessageEvent<unknown>) => {
    if (event.origin !== targetOrigin || event.source !== target || !isPreviewCanvasViewportMessage(event.data)) return;
    accept(event.data);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

// The current @react-three/start preview runtime still imports these names.
// Keep them as compatibility exports until that generated runtime moves to
// the Preview Canvas Viewport names.
export const publishPreviewViewport = publishPreviewCanvasViewport;
export const receivePreviewViewport = receivePreviewCanvasViewport;

function safePostMessage(target: Window | null | undefined, message: unknown, targetOrigin: string): void {
  try {
    target?.postMessage(message, targetOrigin);
  } catch {
    // Browser error documents use an opaque "null" origin. Ignore until the
    // preview frame successfully loads the expected origin and sends ready.
  }
}

function parentEditorOrigin(): string {
  const ancestorOrigin = firstAncestorOrigin();
  if (ancestorOrigin) return ancestorOrigin;
  if (document.referrer) {
    try {
      return new URL(document.referrer).origin;
    } catch {
      return location.origin;
    }
  }
  return location.origin;
}

function firstAncestorOrigin(): string | undefined {
  const ancestorOrigins = (location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  return ancestorOrigins?.[0] || ancestorOrigins?.item?.(0) || undefined;
}

function isCameraMessage(value: unknown): value is { matrixWorld: CameraMatrix; projectionMatrix: CameraMatrix } {
  return isMessage(value, 'editor-camera') && isMatrix(value.matrixWorld) && isMatrix(value.projectionMatrix);
}

function isPreviewCanvasViewportMessage(value: unknown): value is PreviewCanvasViewport {
  return isMessage(value, 'preview-canvas-viewport')
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
