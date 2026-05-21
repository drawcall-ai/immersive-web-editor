/// <reference path="../lucide-icon-modules.d.ts" />

// Editor UI: preview, contributed plugins, and fields are rendered as
// Slot leaves in the editor layout.

import { createElement, isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import {
  Editor as EditorLayout,
  Slot as EditorSlot,
  type EditorRoot,
  type SlotSegment,
  type FolderSegment,
  type SlotPath,
} from '@immersive-web-editor/ui';
import { receiveEditorCamera, receivePreviewCanvasViewport, type PreviewCanvasViewport, type ReceivedEditorCamera } from '@immersive-web-editor/adapter';
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
import type { FieldDescriptor } from './sdk';
import {
  fieldStore,
  mountedFieldStore,
  type ContributionSource,
  type EditorPluginApi,
  type FieldActionOptions,
  type RuntimeField,
  type RuntimeMountedField,
} from './stores';
import * as defaultSchemaComponents from '../default-schema-components';
import {
  DEFAULT_SCHEMA_COMPONENT_MODULE,
  isEditorComponentRef,
  isPreviewToEditorMessage,
  type FieldRegistration,
  type JsonValue,
} from '../rpc';
import type {
  EditorSlotPathSegment,
  EditorFolderPath,
  EditorFolderPathSegment,
  EditorRootPathSegment,
  EditorSlotPath,
} from '../plugin/options';

const DEFAULT_AUTHORED_VALUES_BASE_PATH = '/__editor/authored-values';

export interface InitialCommand {
  id: string;
  title: string;
  hint?: string;
  keybinding?: string;
  scope?: string;
}

export interface EditorPluginModule {
  activate?: (editor: EditorPluginApi) => void | (() => void);
}

export interface EditorUiProps {
  previewUrl: string;
  previewOrigin?: string;
  previewPath: EditorSlotPath;
  overlayPath: EditorSlotPath;
  fieldsPath: EditorFolderPath;
  pluginModules?: Array<{ name: string; module: EditorPluginModule; path?: EditorFolderPath }>;
  pluginCommands?: InitialCommand[];
  authoredValuesBasePath?: string;
}

const EMPTY_PLUGIN_MODULES: NonNullable<EditorUiProps['pluginModules']> = [];
const EMPTY_PLUGIN_COMMANDS: NonNullable<EditorUiProps['pluginCommands']> = [];

function segmentId(value: string | number, prefix: string): string {
  return `${prefix}:${String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'untitled'}`;
}

function folderSegment(
  title: string | number,
  prefix: string,
  actions?: FolderSegment['actions'],
  arrangement: FolderSegment['arrangement'] = 'stack',
  options?: Partial<Pick<FolderSegment, 'defaultActive' | 'defaultCollapsed' | 'hideTitle' | 'icon' | 'preserveFolder' | 'preserveMountedChildren' | 'order' | 'size'>>,
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

function slotSegment(
  title: string | number,
  id: string,
  options?: Partial<Pick<SlotSegment, 'fill' | 'hidden' | 'icon' | 'interactive' | 'order' | 'size' | 'unstyled'>>,
): SlotSegment {
  return {
    id: segmentId(id, 'slot'),
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
    preserveFolder: segment.preserveFolder,
    preserveMountedChildren: segment.preserveMountedChildren,
    order: segment.order,
    size: segment.size,
  };
}

function slotPathSegment(segment: EditorSlotPathSegment): SlotSegment {
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
    slotPathSegment(path[path.length - 1] as EditorSlotPathSegment),
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

function slotPath(parts: readonly (string | number | FolderSegment)[], leaf: SlotSegment): SlotPath {
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
      slotSegment(mount.title, mount.id, { fill: true }),
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
    slotSegment(mount.title, mount.id, { fill: true }),
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
  return fieldRegistration.path.at(-1) ?? fieldRegistration.fieldFolder;
}

async function commitFieldValue(authoredValuesBasePath: string, fieldRegistration: RuntimeField, value: JsonValue): Promise<void> {
  const res = await fetch(`${authoredValuesBasePath}/${encodeURIComponent(fieldRegistration.id)}`, {
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

function FieldOutlet({
  fieldRegistration,
  dataPath,
  field,
  fieldsPath,
  setValue,
  value,
  viewPath,
}: {
  fieldRegistration: RuntimeField;
  dataPath: readonly (string | number)[];
  field: FieldDescriptor;
  fieldsPath: FolderSegment[];
  setValue(value: JsonValue): void;
  value: JsonValue;
  viewPath: readonly (string | number | FolderSegment)[];
}) {
  const rawLabel = (field.label ?? pathPartTitle(viewPath.at(-1))) || inputLabel(fieldRegistration);
  const label = rawLabel || inputLabel(fieldRegistration);
  const fieldsFolder = fieldsPath[fieldsPath.length - 1]!;
  const fieldFolder = folderSegment(fieldRegistration.fieldFolder, `field-folder:${fieldRegistration.fieldFolder}`, undefined, 'accordion');
  const leaf = slotSegment(label, `${fieldRegistration.id}:${dataPath.join('.') || 'value'}`, { icon: descriptorIcon(field) });
  const path = slotPath([...fieldsPath, fieldFolder, ...viewPath.slice(0, -1)], leaf);
  if (typeof field.component !== 'function') {
    return (
      <EditorSlot path={path}>
        <div className={styles.fieldMissingField}>Missing field component.</div>
      </EditorSlot>
    );
  }

  const renderedField = field.component({
    fieldsFolder,
    fieldsPath,
    dataPath,
    defaultValue: descriptorDefault,
    field,
    slotSegment,
    folder: folderSegment,
    label,
    fieldFolder,
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
          fieldsPath={fieldsPath}
          key={options.key}
          value={options.value}
          viewPath={options.viewPath}
          setValue={options.setValue}
        />
      );
    },
    renderSlot(children, slot = path) {
      return <EditorSlot path={slot}>{children}</EditorSlot>;
    },
    slotPath,
  });
  const fieldNode = field.layout === 'block'
    ? renderedField
    : <EditorSlot path={path}>{renderedField}</EditorSlot>;

  return (
    <OverlayCanvasSourceProvider source={fieldRegistration.source}>
      {fieldNode}
    </OverlayCanvasSourceProvider>
  );
}

function FieldContributions({
  authoredValuesBasePath,
  fieldsPath,
}: {
  authoredValuesBasePath: string;
  fieldsPath: FolderSegment[];
}) {
  const [, setVersion] = useState(0);
  useEffect(() => fieldStore.subscribe(() => setVersion((value) => value + 1)), []);
  return (
    <>
      {fieldStore.all().map((fieldRegistration) => (
        <FieldOutlet
          fieldRegistration={fieldRegistration}
          dataPath={[]}
          field={fieldRegistration.field}
          fieldsPath={fieldsPath}
          key={fieldRegistration.id}
          value={fieldRegistration.value as JsonValue}
          viewPath={fieldRegistration.path}
          setValue={(value) => void commitFieldValue(authoredValuesBasePath, fieldRegistration, value)}
        />
      ))}
    </>
  );
}

function PreviewSlots({
  onLoad,
  onUnload,
  overlayPath,
  previewOrigin,
  previewPath,
  src,
}: {
  onLoad: (w: Window) => void;
  onUnload: (w: Window) => void;
  overlayPath: SlotPath;
  previewOrigin: string;
  previewPath: SlotPath;
  src: string;
}) {
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  const [previewWindow, setPreviewWindow] = useState<Window | null>(null);
  const [previewCanvasViewport, setPreviewCanvasViewport] = useState<PreviewCanvasViewport | null>(null);
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
      setPreviewCanvasViewport(null);
      onUnload(currentWindow);
    };
    const detachWindowListeners = () => {
      if (!currentWindow) return;
      try {
        currentWindow.removeEventListener('beforeunload', notifyUnload);
        currentWindow.removeEventListener('pagehide', notifyUnload);
      } catch {
        // Cross-origin error documents expose a Window object but block access
        // to its listener methods.
      }
      currentWindow = null;
    };
    const onFrameLoad = () => {
      detachWindowListeners();
      currentWindow = frame.contentWindow;
      unloaded = false;
      if (!currentWindow) return;
      try {
        currentWindow.addEventListener('beforeunload', notifyUnload);
        currentWindow.addEventListener('pagehide', notifyUnload);
      } catch {
        // The iframe load event is enough to replace cross-origin previews.
      }
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
    return receivePreviewCanvasViewport(previewWindow, setPreviewCanvasViewport, { previewOrigin });
  }, [previewOrigin, previewWindow]);

  return (
    <>
      <EditorSlot path={previewPath}>
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
      </EditorSlot>
      <EditorSlot path={overlayPath}>
        <OverlayCanvasSlotContent target={previewWindow} previewCanvasViewport={previewCanvasViewport} previewOrigin={previewOrigin} />
      </EditorSlot>
    </>
  );
}

function OverlayCanvasSlotContent({
  previewCanvasViewport,
  previewOrigin,
  target,
}: {
  previewCanvasViewport: PreviewCanvasViewport | null;
  previewOrigin: string;
  target: Window | null;
}) {
  const entries = useOverlayCanvasEntries();
  const viewportStyle = useMemo<CSSProperties>(() => {
    if (!previewCanvasViewport || previewCanvasViewport.canvasRect.width <= 0 || previewCanvasViewport.canvasRect.height <= 0) return { inset: 0 };
    return {
      left: previewCanvasViewport.canvasRect.left,
      top: previewCanvasViewport.canvasRect.top,
      width: previewCanvasViewport.canvasRect.width,
      height: previewCanvasViewport.canvasRect.height,
    };
  }, [previewCanvasViewport]);

  return (
    <div className={styles.overlayCanvasSlot}>
      <div className={styles.overlayCanvasViewport} style={viewportStyle}>
        <Canvas
          camera={{ position: [0, 0, 5], fov: 45 }}
          className={styles.overlayCanvas}
          events={noEvents}
          gl={{ alpha: true, antialias: true }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
        >
          <PointerEvents />
          <OrbitHandles />
          <EditorCameraPublisher target={target} previewOrigin={previewOrigin} />
          <OverlayCanvasContent entries={entries} />
        </Canvas>
      </div>
    </div>
  );
}

function EditorCameraPublisher({ previewOrigin, target }: { previewOrigin: string; target: Window | null }) {
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
    }, { previewOrigin });
    return () => {
      publisher.current?.dispose();
      publisher.current = null;
    };
  }, [camera, previewOrigin, target]);

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
    <EditorSlot path={mountedFieldPath(mount)}>
      <div
        className={styles.slotBody}
        data-editor-slot-id={mount.id}
        ref={setContainer}
        tabIndex={-1}
      />
    </EditorSlot>
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

function originFromUrl(url: string): string {
  try {
    return new URL(url, window.location.href).origin;
  } catch {
    return window.location.origin;
  }
}

export function EditorUi({
  authoredValuesBasePath = DEFAULT_AUTHORED_VALUES_BASE_PATH,
  fieldsPath,
  overlayPath,
  pluginCommands = EMPTY_PLUGIN_COMMANDS,
  pluginModules = EMPTY_PLUGIN_MODULES,
  previewOrigin,
  previewPath,
  previewUrl,
}: EditorUiProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const resolvedPreviewOrigin = useMemo(() => previewOrigin ?? originFromUrl(previewUrl), [previewOrigin, previewUrl]);
  const editorRoot = useMemo(() => rootSegment(previewPath[0]), [previewPath]);
  const configuredPreviewPath = useMemo(() => configuredSlotPath(previewPath), [previewPath]);
  const configuredOverlayPath = useMemo(() => configuredSlotPath(overlayPath), [overlayPath]);
  const configuredFieldsPath = useMemo(() => configuredFolderPath(fieldsPath), [fieldsPath]);

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
      if (event.origin !== resolvedPreviewOrigin || !event.source || !('postMessage' in event.source)) return;
      if (!isPreviewToEditorMessage(event.data)) return;
      if (event.data.type === 'editor:addField') {
        void addSerializedField(event.data.field, event.source as Window);
      } else if (event.data.type === 'editor:removeFieldsByModulePath') {
        fieldStore.removeByModulePath(event.source as Window, event.data.modulePaths);
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [resolvedPreviewOrigin]);

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
          try {
            frame?.contentWindow?.location.reload();
          } catch {
            frame?.setAttribute('src', frame.src);
          }
        },
      }),
      commands.register({
        id: 'editor.layout.reset',
        title: 'Layout: reset to default',
        run: () => mountedFieldStore.emit(),
      }),
    );

    for (const cmd of pluginCommands) {
      unsubs.push(commands.register({
        ...cmd,
        run: () => focusSlot(cmd.scope ?? cmd.id.replace(/\.focus$/, '')),
      }));
    }

    const pluginSources: ContributionSource[] = [];
    let alive = true;
    for (const pluginModule of pluginModules) {
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
  }, [pluginCommands, pluginModules]);

  return (
    <div className={styles.editorUi}>
      <EditorLayout root={editorRoot}>
        <PreviewSlots
          src={previewUrl}
          previewOrigin={resolvedPreviewOrigin}
          previewPath={configuredPreviewPath}
          overlayPath={configuredOverlayPath}
          onLoad={handleIframeLoad}
          onUnload={handleIframeUnload}
        />
        <FieldContributions authoredValuesBasePath={authoredValuesBasePath} fieldsPath={configuredFieldsPath} />
        <RuntimeMountedFields />
      </EditorLayout>
      <Palette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
