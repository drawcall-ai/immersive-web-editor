/// <reference path="../lucide-icon-modules.d.ts" />

// Minimal editor shell. The workbench layout is entirely provided by
// immersive-web-editor: preview, contributed plugins, and config fields are all
// rendered as Slot leaves.

import { createElement, isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Editor as WorkbenchEditor,
  Slot as WorkbenchSlot,
  type EditorRoot,
  type FieldSegment,
  type FolderSegment,
  type SlotPath,
} from '@immersive-web-editor/ui';
import { receiveEditorCamera, receivePreviewViewport, type PreviewViewport, type ReceivedEditorCamera } from '@immersive-web-editor/adapter';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitHandles } from '@react-three/handle';
import { PointerEvents, noEvents } from '@react-three/xr';
import Bot from 'lucide-react/dist/esm/icons/bot.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import FolderIcon from 'lucide-react/dist/esm/icons/folder.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js';
import MonitorPlay from 'lucide-react/dist/esm/icons/monitor-play.js';
import SlidersHorizontal from 'lucide-react/dist/esm/icons/sliders-horizontal.js';
import Type from 'lucide-react/dist/esm/icons/type.js';
import * as commands from './commands';
import { useKeybindings } from './commands';
import {
  OverlayCanvasContent,
  OverlayCanvasSourceProvider,
  removeOverlayCanvasEntriesBySource,
  useOverlayCanvasEntries,
} from './overlay-canvas';
import { Palette } from './palette';
import { styles } from './styles';
import type { CommandOptions, FieldDescriptor } from './sdk';
import * as defaultSchemaComponents from '../default-schema-components';
import {
  configPath as configuredConfigPath,
  overlayPath as configuredOverlayPath,
  pluginCommands as configuredPluginCommands,
  pluginModules as configuredPluginModules,
  previewPath as configuredPreviewPath,
  previewUrl as configuredPreviewUrl,
} from 'virtual:editor/config';
import {
  DEFAULT_SCHEMA_COMPONENT_MODULE,
  isEditorComponentRef,
  isPreviewToEditorMessage,
  type FieldRegistration,
  type JsonValue,
} from '../rpc';
import type {
  EditorFieldPathSegment,
  EditorFolderPath,
  EditorFolderPathSegment,
  EditorRootPathSegment,
  EditorSlotPath,
} from '../plugin/options';

interface FieldActionOptions {
  id: string;
  label: string;
  icon?: ComponentType<any> | string;
  disabled?: boolean;
  run: () => void | Promise<void>;
}

interface MountedFieldOptions {
  id: string;
  title: string;
  actions?: FieldActionOptions[];
  mount: (container: HTMLElement) => () => void;
}

interface EditorPluginApi {
  addField(opts: MountedFieldOptions): () => void;
  removeField(id: string): void;
  addCommand(opts: CommandOptions): () => void;
  removeCommand(id: string): void;
}

interface InitialCommand {
  id: string;
  title: string;
  hint?: string;
  keybinding?: string;
  scope?: string;
}

interface EditorConfig {
  previewUrl: string;
  previewPath: EditorSlotPath;
  overlayPath: EditorSlotPath;
  configPath: EditorFolderPath;
  pluginModules: Array<{ name: string; module: EditorPluginModule; path?: EditorFolderPath }>;
  pluginCommands: InitialCommand[];
}

type ContributionSource = Window | object;

interface RuntimeField extends Omit<FieldRegistration, 'field'> {
  field: FieldDescriptor;
  source: Window;
}

interface RuntimeMountedField {
  id: string;
  title: string;
  actions?: FieldActionOptions[];
  mount: MountedFieldOptions['mount'];
  path?: FolderSegment[];
  source: ContributionSource;
  order: number;
}

let nextSlotOrder = 0;

const mountedFieldStore = {
  mounts: new Map<string, RuntimeMountedField>(),
  listeners: new Set<() => void>(),
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  emit(): void {
    for (const listener of this.listeners) listener();
  },
  upsert(mount: Omit<RuntimeMountedField, 'order'> & { order?: number }): void {
    const previous = this.mounts.get(mount.id);
    this.mounts.set(mount.id, {
      ...mount,
      order: mount.order ?? previous?.order ?? nextSlotOrder++,
    });
    this.emit();
  },
  remove(id: string): void {
    this.mounts.delete(id);
    this.emit();
  },
  removeBySource(source: ContributionSource): void {
    let changed = false;
    for (const [id, mount] of this.mounts) {
      if (mount.source !== source) continue;
      this.mounts.delete(id);
      changed = true;
    }
    if (changed) this.emit();
  },
  all(): RuntimeMountedField[] {
    return [...this.mounts.values()].sort((a, b) => {
      const order = a.order - b.order;
      if (order !== 0) return order;
      return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
    });
  },
};

const fieldStore = {
  fields: new Map<string, RuntimeField>(),
  listeners: new Set<() => void>(),
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  emit(): void {
    for (const listener of this.listeners) listener();
  },
  upsert(fieldRegistration: RuntimeField): void {
    this.fields.set(fieldRegistration.id, fieldRegistration);
    this.emit();
  },
  remove(id: string): void {
    this.fields.delete(id);
    this.emit();
  },
  removeBySource(source: ContributionSource): void {
    let changed = false;
    for (const [id, fieldRegistration] of this.fields) {
      if (fieldRegistration.source !== source) continue;
      this.fields.delete(id);
      changed = true;
    }
    if (changed) this.emit();
  },
  all(): RuntimeField[] {
    return [...this.fields.values()].sort((a, b) => {
      const panel = a.panel.localeCompare(b.panel, undefined, { numeric: true, sensitivity: 'base' });
      if (panel !== 0) return panel;
      return a.path.join('.').localeCompare(b.path.join('.'), undefined, { numeric: true, sensitivity: 'base' });
    });
  },
};

function segmentId(value: string | number, prefix: string): string {
  return `${prefix}:${String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'untitled'}`;
}

function folderSegment(
  title: string | number,
  prefix: string,
  actions?: FolderSegment['actions'],
  arrangement: FolderSegment['arrangement'] = 'stack',
  options?: Partial<Pick<FolderSegment, 'defaultActive' | 'defaultCollapsed' | 'hideTitle' | 'icon' | 'keepAlive' | 'order' | 'size'>>,
): FolderSegment {
  const icon = options && 'icon' in options ? options.icon : folderIcon(String(title), prefix);
  return {
    id: segmentId(title, prefix),
    title: String(title),
    icon,
    arrangement,
    actions,
    ...options,
  };
}

function fieldSegment(
  title: string | number,
  id: string,
  options?: Partial<Pick<FieldSegment, 'fill' | 'hidden' | 'icon' | 'interactive' | 'order' | 'size' | 'unstyled'>>,
): FieldSegment {
  return {
    id: segmentId(id, 'field'),
    title: String(title),
    icon: options?.icon ?? <Type aria-hidden />,
    ...options,
  };
}

function rootSegment(segment: EditorRootPathSegment): EditorRoot {
  return {
    id: segment.id,
    title: segment.title,
    icon: folderIcon(segment.title, segment.id ?? segment.title),
    arrangement: segment.arrangement,
  };
}

function folderPathSegment(segment: EditorFolderPathSegment): FolderSegment {
  return {
    id: segment.id,
    title: segment.title,
    icon: folderIcon(segment.title, segment.id ?? segment.title),
    arrangement: segment.arrangement,
    defaultActive: segment.defaultActive,
    defaultCollapsed: segment.defaultCollapsed,
    hideTitle: segment.hideTitle,
    keepAlive: segment.keepAlive,
    order: segment.order,
    size: segment.size,
  };
}

function fieldPathSegment(segment: EditorFieldPathSegment): FieldSegment {
  return {
    id: segment.id,
    title: segment.title,
    icon: <Type aria-hidden />,
    align: segment.align,
    fill: segment.fill,
    hidden: segment.hidden,
    interactive: segment.interactive,
    order: segment.order,
    size: segment.size,
    unstyled: segment.unstyled,
  };
}

function configuredSlotPath(path: EditorSlotPath): SlotPath {
  return [
    ...path.slice(1, -1).map((segment) => folderPathSegment(segment as EditorFolderPathSegment)),
    fieldPathSegment(path[path.length - 1] as EditorFieldPathSegment),
  ] as SlotPath;
}

function configuredFolderPath(path: EditorFolderPath): FolderSegment[] {
  return path.slice(1).map((segment) => folderPathSegment(segment));
}

function folderIcon(title: string, id: string): ReactNode {
  const normalized = `${id} ${title}`.toLowerCase();
  if (normalized.includes('preview')) return <MonitorPlay aria-hidden />;
  if (normalized.includes('config')) return <SlidersHorizontal aria-hidden />;
  if (normalized.includes('chat')) return <Bot aria-hidden />;
  if (normalized.includes('notes')) return <FileText aria-hidden />;
  return <FolderIcon aria-hidden />;
}

function pathPartTitle(part: string | number | FolderSegment | undefined): string {
  if (part === undefined) return '';
  return typeof part === 'object' ? part.title : String(part);
}

function slotPath(parts: readonly (string | number | FolderSegment)[], leaf: FieldSegment): SlotPath {
  return [
    ...parts.map((part, index) => (
      typeof part === 'object'
        ? part
        : folderSegment(part, `folder-${index}`)
    )),
    leaf,
  ];
}

function mountedFieldPath(mount: Pick<RuntimeMountedField, 'actions' | 'id' | 'order' | 'path' | 'title'>): SlotPath {
  if (mount.id.startsWith('editor:chat:')) {
    return slotPath(
      [
        ...(mount.path ?? []),
        folderSegment(
          mount.title,
          `slot:${mount.id}`,
          slotActions(mount.actions),
          'stack',
          { defaultActive: mount.order === 0, icon: null, order: mount.order },
        ),
      ],
      fieldSegment(mount.title, mount.id, { fill: true }),
    );
  }

  return slotPath(
    [
      ...(mount.path ?? [
        folderSegment(
          'Plugins',
          'editor:plugins',
          undefined,
          'tabs',
          { order: 10, size: 24 },
        ),
      ]),
      folderSegment(
        mount.title,
        `slot:${mount.id}`,
        slotActions(mount.actions),
        'stack',
        { defaultActive: mount.title.toLowerCase() === 'chat' },
      ),
    ],
    fieldSegment(mount.title, mount.id, { fill: true }),
  );
}

function slotActions(actions: FieldActionOptions[] | undefined): FolderSegment['actions'] {
  return actions?.map((action) => ({
    id: action.id,
    label: action.label,
    icon: action.icon ?? Type,
    disabled: action.disabled,
    run: action.run,
  }));
}

function focusSlot(id: string): void {
  const slot = document.querySelector<HTMLElement>(`[data-editor-slot-id="${CSS.escape(id)}"]`);
  slot?.focus();
  slot?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function inputLabel(fieldRegistration: RuntimeField): string {
  return fieldRegistration.path.at(-1) ?? fieldRegistration.panel;
}

async function commitFieldValue(fieldRegistration: RuntimeField, value: JsonValue): Promise<void> {
  const res = await fetch(`/__editor/configurables/${encodeURIComponent(fieldRegistration.id)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(await res.text());
  fieldRegistration.value = value;
  fieldStore.emit();
}

function descriptorDefault(field: FieldDescriptor): JsonValue {
  return cloneJson((field.defaultValue ?? null) as JsonValue);
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function descriptorProps(field: FieldDescriptor): Record<string, unknown> {
  return field.props && typeof field.props === 'object' && !Array.isArray(field.props)
    ? field.props as Record<string, unknown>
    : {};
}

function descriptorIcon(field: FieldDescriptor): ReactNode {
  const icon = descriptorProps(field).icon;
  if (isValidElement(icon)) return icon;
  if (typeof icon === 'function') return createElement(icon as ComponentType<{ 'aria-hidden'?: boolean }>, { 'aria-hidden': true });
  return <Type aria-hidden />;
}

const editorConfig: EditorConfig = {
  previewUrl: configuredPreviewUrl || '/',
  previewPath: configuredPreviewPath,
  overlayPath: configuredOverlayPath,
  configPath: configuredConfigPath,
  pluginModules: configuredPluginModules,
  pluginCommands: configuredPluginCommands,
};

function FieldOutlet({
  fieldRegistration,
  dataPath,
  field,
  setValue,
  value,
  viewPath,
}: {
  fieldRegistration: RuntimeField;
  dataPath: readonly (string | number)[];
  field: FieldDescriptor;
  setValue(value: JsonValue): void;
  value: JsonValue;
  viewPath: readonly (string | number | FolderSegment)[];
}) {
  const rawLabel = (field.label ?? pathPartTitle(viewPath.at(-1))) || inputLabel(fieldRegistration);
  const label = rawLabel || inputLabel(fieldRegistration);
  const configPath = configuredFolderPath(editorConfig.configPath);
  const configFolder = configPath[configPath.length - 1]!;
  const panelFolder = folderSegment(fieldRegistration.panel, `config:${fieldRegistration.panel}`, undefined, 'accordion');
  const leaf = fieldSegment(label, `${fieldRegistration.id}:${dataPath.join('.') || 'value'}`, { icon: descriptorIcon(field) });
  const path = slotPath([...configPath, panelFolder, ...viewPath.slice(0, -1)], leaf);
  if (typeof field.component !== 'function') {
    return (
      <WorkbenchSlot path={path}>
        <div className={styles.configMissingField}>Missing field component.</div>
      </WorkbenchSlot>
    );
  }

  const renderedField = field.component({
    configFolder,
    configPath,
    dataPath,
    defaultValue: descriptorDefault,
    field,
    fieldSegment,
    folder: folderSegment,
    label,
    panelFolder,
    path,
    setValue,
    value,
    viewPath,
    renderField(options) {
      return (
        <FieldOutlet
          fieldRegistration={fieldRegistration}
          dataPath={options.dataPath}
          field={options.field}
          key={options.key}
          value={options.value}
          viewPath={options.viewPath}
          setValue={options.setValue}
        />
      );
    },
    renderSlot(children, slot = path) {
      return <WorkbenchSlot path={slot}>{children}</WorkbenchSlot>;
    },
    slotPath,
  });
  const fieldNode = field.layout === 'block'
    ? renderedField
    : <WorkbenchSlot path={path}>{renderedField}</WorkbenchSlot>;

  return (
    <OverlayCanvasSourceProvider source={fieldRegistration.source}>
      {fieldNode}
    </OverlayCanvasSourceProvider>
  );
}

function FieldContributions() {
  const [, setVersion] = useState(0);
  useEffect(() => fieldStore.subscribe(() => setVersion((value) => value + 1)), []);
  return (
    <>
      {fieldStore.all().map((fieldRegistration) => (
        <FieldOutlet
          fieldRegistration={fieldRegistration}
          dataPath={[]}
          field={fieldRegistration.field}
          key={fieldRegistration.id}
          value={fieldRegistration.value as JsonValue}
          viewPath={fieldRegistration.path}
          setValue={(value) => void commitFieldValue(fieldRegistration, value)}
        />
      ))}
    </>
  );
}

function PreviewSlots({
  onLoad,
  onUnload,
  overlayPath,
  previewPath,
  src,
}: {
  onLoad: (w: Window) => void;
  onUnload: (w: Window) => void;
  overlayPath: SlotPath;
  previewPath: SlotPath;
  src: string;
}) {
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  const [previewWindow, setPreviewWindow] = useState<Window | null>(null);
  const [previewViewport, setPreviewViewport] = useState<PreviewViewport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
  }, [src]);

  useEffect(() => {
    if (!frame) return;
    let currentWindow: Window | null = null;
    let unloaded = false;
    const notifyUnload = () => {
      if (!currentWindow || unloaded) return;
      unloaded = true;
      setLoading(true);
      setPreviewWindow(null);
      setPreviewViewport(null);
      onUnload(currentWindow);
    };
    const detachWindowListeners = () => {
      if (!currentWindow) return;
      currentWindow.removeEventListener('beforeunload', notifyUnload);
      currentWindow.removeEventListener('pagehide', notifyUnload);
      currentWindow = null;
    };
    const onFrameLoad = () => {
      detachWindowListeners();
      currentWindow = frame.contentWindow;
      unloaded = false;
      if (!currentWindow) return;
      currentWindow.addEventListener('beforeunload', notifyUnload);
      currentWindow.addEventListener('pagehide', notifyUnload);
      setPreviewWindow(currentWindow);
      onLoad(currentWindow);
      setLoading(false);
    };
    frame.addEventListener('load', onFrameLoad);
    try {
      if (frame.contentDocument?.readyState === 'complete') queueMicrotask(onFrameLoad);
    } catch {
      // Cross-origin previews still notify through the load event.
    }
    return () => {
      notifyUnload();
      detachWindowListeners();
      frame.removeEventListener('load', onFrameLoad);
    };
  }, [frame, onLoad, onUnload]);

  useEffect(() => {
    if (!previewWindow) return undefined;
    return receivePreviewViewport(previewWindow, setPreviewViewport);
  }, [previewWindow]);

  return (
    <>
      <WorkbenchSlot path={previewPath}>
        <div className={styles.previewFrameSlot}>
          <iframe
            ref={setFrame}
            className={styles.iframe}
            src={src}
            tabIndex={-1}
            title="Preview"
          />
          {loading && (
            <div className={styles.previewLoading} role="status" aria-label="Loading preview">
              <Loader2 aria-hidden className={styles.spinner} size={22} />
            </div>
          )}
        </div>
      </WorkbenchSlot>
      <WorkbenchSlot path={overlayPath}>
        <OverlayCanvasLayer target={previewWindow} viewport={previewViewport} />
      </WorkbenchSlot>
    </>
  );
}

function OverlayCanvasLayer({ target, viewport }: { target: Window | null; viewport: PreviewViewport | null }) {
  const entries = useOverlayCanvasEntries();
  const viewportStyle = useMemo<CSSProperties>(() => {
    if (!viewport || viewport.canvasRect.width <= 0 || viewport.canvasRect.height <= 0) return { inset: 0 };
    return {
      left: viewport.canvasRect.left,
      top: viewport.canvasRect.top,
      width: viewport.canvasRect.width,
      height: viewport.canvasRect.height,
    };
  }, [viewport]);

  return (
    <div className={styles.previewCanvasLayer}>
      <div className={styles.previewCanvasViewport} style={viewportStyle}>
        <Canvas
          camera={{ position: [0, 0, 5], fov: 45 }}
          className={styles.previewCanvas}
          events={noEvents}
          gl={{ alpha: true, antialias: true }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
        >
          <PointerEvents />
          <OrbitHandles />
          <EditorCameraPublisher target={target} />
          <OverlayCanvasContent entries={entries} />
        </Canvas>
      </div>
    </div>
  );
}

function EditorCameraPublisher({ target }: { target: Window | null }) {
  const camera = useThree((state) => state.camera);
  const publisher = useRef<ReceivedEditorCamera | null>(null);

  useEffect(() => {
    publisher.current?.dispose();
    publisher.current = null;
    if (!target) return;
    publisher.current = receiveEditorCamera(target, () => {
      if ('updateProjectionMatrix' in camera && typeof camera.updateProjectionMatrix === 'function') camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      return {
        matrixWorld: camera.matrixWorld.elements,
        projectionMatrix: camera.projectionMatrix.elements,
      };
    });
    return () => {
      publisher.current?.dispose();
      publisher.current = null;
    };
  }, [camera, target]);

  useFrame(() => publisher.current?.submit());

  return null;
}

function RuntimeMountedField({ mount }: { mount: RuntimeMountedField }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!container) return undefined;
    const cleanup = mount.mount(container);
    return () => {
      cleanup?.();
    };
  }, [container, mount.mount]);

  return (
    <WorkbenchSlot path={mountedFieldPath(mount)}>
      <div
        className={styles.slotBody}
        data-editor-slot-id={mount.id}
        ref={setContainer}
        tabIndex={-1}
      />
    </WorkbenchSlot>
  );
}

function RuntimeMountedFields() {
  const [, setVersion] = useState(0);
  useEffect(() => mountedFieldStore.subscribe(() => setVersion((value) => value + 1)), []);
  return (
    <>
      {mountedFieldStore.all().map((mount) => <RuntimeMountedField key={mount.id} mount={mount} />)}
    </>
  );
}

interface EditorPluginModule {
  activate?: (editor: EditorPluginApi) => void | (() => void);
}

const importEditorComponent = new Function('src', 'return import(src)') as (src: string) => Promise<Record<string, unknown>>;

function resolveDefaultSchemaComponent(exportName: string): unknown {
  return (defaultSchemaComponents as Record<string, unknown>)[exportName];
}

async function hydrateFieldDescriptor(value: unknown): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map((item) => hydrateFieldDescriptor(item)));
  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  const entries = await Promise.all(
    Object.entries(record).map(async ([key, item]) => [key, await hydrateFieldDescriptor(item)] as const),
  );
  const next = Object.fromEntries(entries) as Record<string, unknown>;

  if (!isEditorComponentRef(record.component)) return next;

  const component = record.component.module === DEFAULT_SCHEMA_COMPONENT_MODULE
    ? resolveDefaultSchemaComponent(record.component.exportName)
    : (await importEditorComponent(record.component.module))[record.component.exportName];
  if (typeof component !== 'function') {
    console.warn(`[editor] Missing field component export "${record.component.exportName}" from ${record.component.module}.`);
    return next;
  }

  next.component = component;
  return next;
}

async function addSerializedField(fieldRegistration: FieldRegistration, source: Window): Promise<void> {
  const field = await hydrateFieldDescriptor(fieldRegistration.field);
  if (!field || typeof field !== 'object' || typeof (field as FieldDescriptor).component !== 'function') {
    console.warn(`[editor] Missing field component export "${fieldRegistration.field.component.exportName}" from ${fieldRegistration.field.component.module}.`);
    return;
  }

  fieldStore.upsert({
    ...fieldRegistration,
    field: field as FieldDescriptor,
    source,
  });
}

function createPluginApi(source: ContributionSource, path: EditorFolderPath | undefined): EditorPluginApi {
  const configuredPath = path ? configuredFolderPath(path) : undefined;
  return {
    addField(opts) {
      mountedFieldStore.upsert({
        id: opts.id,
        title: opts.title,
        actions: opts.actions,
        mount: opts.mount,
        path: configuredPath,
        source,
        order: opts.id === 'editor:chat:loading' ? -1 : undefined,
      });
      return () => {
        const mount = mountedFieldStore.mounts.get(opts.id);
        if (mount?.source === source) mountedFieldStore.remove(opts.id);
      };
    },
    removeField(id) {
      const mount = mountedFieldStore.mounts.get(id);
      if (mount?.source === source) mountedFieldStore.remove(id);
    },
    addCommand(opts) {
      return commands.register(opts);
    },
    removeCommand(id) {
      commands.unregister(id);
    },
  };
}

function EditorShell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const config = useMemo(() => editorConfig, []);
  const workbenchRoot = useMemo(() => rootSegment(config.previewPath[0]), [config.previewPath]);
  const previewPath = useMemo(() => configuredSlotPath(config.previewPath), [config.previewPath]);
  const overlayPath = useMemo(() => configuredSlotPath(config.overlayPath), [config.overlayPath]);

  useKeybindings();

  const handleIframeLoad = useCallback((_w: Window) => undefined, []);

  const handleIframeUnload = useCallback((source: Window) => {
    mountedFieldStore.removeBySource(source);
    fieldStore.removeBySource(source);
    removeOverlayCanvasEntriesBySource(source);
    commands.clearBySource(source);
  }, []);

  useLayoutEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || !event.source || !('postMessage' in event.source)) return;
      if (!isPreviewToEditorMessage(event.data)) return;
      if (event.data.type === 'editor:addField') {
        void addSerializedField(event.data.field, event.source as Window);
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    unsubs.push(
      commands.register({
        id: 'editor.palette.open',
        title: 'Commands: open palette',
        hint: '⌘K',
        keybinding: 'mod+k',
        run: () => setPaletteOpen(true),
      }),
      commands.register({
        id: 'editor.preview.reload',
        title: 'Preview: reload',
        run: () => {
          const frame = document.querySelector<HTMLIFrameElement>(`iframe.${styles.iframe}`);
          frame?.contentWindow?.location.reload();
        },
      }),
      commands.register({
        id: 'editor.layout.reset',
        title: 'Layout: reset to default',
        run: () => mountedFieldStore.emit(),
      }),
    );

    for (const cmd of config.pluginCommands) {
      unsubs.push(commands.register({
        ...cmd,
        run: () => focusSlot(cmd.scope ?? cmd.id.replace(/\.focus$/, '')),
      }));
    }

    const pluginSources: ContributionSource[] = [];
    let alive = true;
    for (const pluginModule of config.pluginModules) {
      const source = {};
      pluginSources.push(source);
      try {
        const cleanup = pluginModule.module.activate?.(createPluginApi(source, pluginModule.path));
        if (alive && typeof cleanup === 'function') unsubs.push(cleanup);
      } catch (err) {
        console.error(`[editor] Failed to activate plugin "${pluginModule.name}".`, err);
      }
    }

    return () => {
      alive = false;
      for (const unsubscribe of unsubs) unsubscribe();
      for (const source of pluginSources) mountedFieldStore.removeBySource(source);
    };
  }, [config.pluginCommands, config.pluginModules]);

  return (
    <div className={styles.shell}>
      <WorkbenchEditor root={workbenchRoot}>
        <PreviewSlots
          src={config.previewUrl}
          previewPath={previewPath}
          overlayPath={overlayPath}
          onLoad={handleIframeLoad}
          onUnload={handleIframeUnload}
        />
        <FieldContributions />
        <RuntimeMountedFields />
      </WorkbenchEditor>
      <Palette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

const root = document.createElement('div');
root.id = '__editor_root__';
document.documentElement.style.width = '100%';
document.documentElement.style.height = '100%';
document.documentElement.style.margin = '0';
document.documentElement.style.padding = '0';
document.documentElement.style.overflow = 'hidden';
document.body.style.width = '100%';
document.body.style.height = '100%';
document.body.style.margin = '0';
document.body.style.padding = '0';
document.body.style.overflow = 'hidden';
root.style.width = '100%';
root.style.height = '100%';
root.style.overflow = 'hidden';
document.body.appendChild(root);
createRoot(root).render(<EditorShell />);
