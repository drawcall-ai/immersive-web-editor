import {
  createContext,
  Fragment,
  useContext,
  useId,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

type OverlayCanvasEntry = readonly [string, ReactNode];
export type OverlayCanvasEntries = readonly OverlayCanvasEntry[];

type OverlayCanvasSource = Window | null;

interface OverlayCanvasRecord {
  node: ReactNode;
  source: OverlayCanvasSource;
}

interface OverlayCanvasStore {
  entries: Map<string, OverlayCanvasRecord>;
  listeners: Set<() => void>;
  snapshot: OverlayCanvasEntries;
  emit(): void;
  set(id: string, node: ReactNode, source: OverlayCanvasSource): void;
  remove(id: string): void;
  removeBySource(source: Window): void;
  subscribe(listener: () => void): () => void;
}

function createOverlayCanvasStore(): OverlayCanvasStore {
  return {
    entries: new Map<string, OverlayCanvasRecord>(),
    listeners: new Set<() => void>(),
    snapshot: [],
    emit() {
      this.snapshot = [...this.entries.entries()].map(([id, entry]) => [id, entry.node] as const);
      for (const listener of this.listeners) listener();
    },
    set(id, node, source) {
      this.entries.set(id, { node, source });
      this.emit();
    },
    remove(id) {
      this.entries.delete(id);
      this.emit();
    },
    removeBySource(source) {
      let changed = false;
      for (const [id, entry] of this.entries) {
        if (entry.source !== source) continue;
        this.entries.delete(id);
        changed = true;
      }
      if (changed) this.emit();
    },
    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
  };
}

const overlayCanvasStore = createOverlayCanvasStore();
const OverlayCanvasSourceContext = createContext<OverlayCanvasSource>(null);

export function removeOverlayCanvasEntriesBySource(source: Window): void {
  overlayCanvasStore.removeBySource(source);
}

export function OverlayCanvasSourceProvider({ children, source }: { children: ReactNode; source: Window }) {
  return <OverlayCanvasSourceContext.Provider value={source}>{children}</OverlayCanvasSourceContext.Provider>;
}

export function OverlayCanvasPortal({ children }: { children: ReactNode }) {
  const id = useId();
  const source = useContext(OverlayCanvasSourceContext);

  useLayoutEffect(() => {
    overlayCanvasStore.set(id, children, source);
    return () => overlayCanvasStore.remove(id);
  }, [children, id, source]);

  return null;
}

export function useOverlayCanvasEntries(): OverlayCanvasEntries {
  return useSyncExternalStore(
    (listener) => overlayCanvasStore.subscribe(listener),
    () => overlayCanvasStore.snapshot,
    () => [],
  );
}

export function OverlayCanvasContent({ entries }: { entries: OverlayCanvasEntries }) {
  return <>{entries.map(([id, node]) => <Fragment key={id}>{node}</Fragment>)}</>;
}
