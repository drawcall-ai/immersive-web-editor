import assert from 'node:assert/strict';
import { test } from 'node:test';

import { receiveEditorCamera } from '../src/index';

const matrixWorld = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1] as const;
const projectionMatrix = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0] as const;

test('receiveEditorCamera can submit before a ready message is observed', () => {
  const { restore } = installWindow();
  const posted: unknown[] = [];
  const target = {
    postMessage(message: unknown) {
      posted.push(message);
    },
  } as Window;

  try {
    const publisher = receiveEditorCamera(target, () => ({ matrixWorld, projectionMatrix }), { previewOrigin: 'https://preview.test' });
    publisher.submit();
    publisher.dispose();
  } finally {
    restore();
  }

  assert.equal(posted.length, 1);
  assert.deepEqual(posted[0], {
    source: '@immersive-web-editor/adapter',
    type: 'editor-camera',
    matrixWorld,
    projectionMatrix,
  });
});

test('receiveEditorCamera still submits immediately when the preview announces readiness', () => {
  const { dispatch, restore } = installWindow();
  const posted: unknown[] = [];
  const target = {
    postMessage(message: unknown) {
      posted.push(message);
    },
  } as Window;

  try {
    const publisher = receiveEditorCamera(target, () => ({ matrixWorld, projectionMatrix }), { previewOrigin: 'https://preview.test' });
    dispatch({
      origin: 'https://preview.test',
      source: target,
      data: { source: '@immersive-web-editor/adapter', type: 'editor-camera:ready' },
    } as MessageEvent);
    publisher.dispose();
  } finally {
    restore();
  }

  assert.equal(posted.length, 1);
});

function installWindow(): { dispatch(event: MessageEvent<unknown>): void; restore(): void } {
  const listeners = new Set<(event: MessageEvent<unknown>) => void>();
  const previousWindow = globalThis.window;
  const previousLocation = globalThis.location;

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void) {
        if (type === 'message') listeners.add(listener);
      },
      removeEventListener(type: string, listener: (event: MessageEvent<unknown>) => void) {
        if (type === 'message') listeners.delete(listener);
      },
    },
  });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { origin: 'https://editor.test' },
  });

  return {
    dispatch(event) {
      for (const listener of listeners) listener(event);
    },
    restore() {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
      Object.defineProperty(globalThis, 'location', { configurable: true, value: previousLocation });
    },
  };
}
