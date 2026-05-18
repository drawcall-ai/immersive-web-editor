/// <reference path="./lucide-icon-modules.d.ts" />

import {
  Fragment,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ElementType,
  type KeyboardEvent,
  type RefObject,
  type ReactNode,
} from 'react';
import * as Accordion from '@radix-ui/react-accordion';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Tabs from '@radix-ui/react-tabs';
import * as Tooltip from '@radix-ui/react-tooltip';
import { createPortal } from 'react-dom';
import { css, cx } from '@emotion/css';
import type { LucideIcon } from 'lucide-react';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js';
import { Group, Panel, Separator } from 'react-resizable-panels';

export type Arrangement =
  | 'nav-bottom'
  | 'nav-left'
  | 'nav-left-icons'
  | 'nav-top'
  | 'nav-top-icons'
  | 'dock-column'
  | 'dock-row'
  | 'dropdown'
  | 'layer-stack'
  | 'tabs'
  | 'accordion'
  | 'stack'
  | 'grid';

export type Align = 'start' | 'center' | 'end' | 'stretch';

export interface FolderAction {
  id: string;
  label: string;
  icon: ReactNode | ElementType | LucideIcon;
  disabled?: boolean;
  run(): void;
}

export interface FolderSegment {
  id?: string;
  title: string;
  icon: ReactNode;
  arrangement: Arrangement;
  actions?: readonly FolderAction[];
  defaultActive?: boolean;
  defaultCollapsed?: boolean;
  hideTitle?: boolean;
  order?: number;
  size?: number;
}

export interface FieldSegment {
  id?: string;
  title: string;
  icon?: ReactNode;
  arrangement?: never;
  align?: Align;
  fill?: boolean;
  hidden?: boolean;
  interactive?: boolean;
  order?: number;
  size?: number;
  unstyled?: boolean;
}

export type SlotPath = readonly [FieldSegment] | readonly [...FolderSegment[], FieldSegment];

export interface EditorRoot {
  id?: string;
  title: string;
  icon: ReactNode;
  arrangement: Arrangement;
}

interface SlotRecord {
  id: string;
  path: SlotPath;
  sourceOrder: number;
  contentVersion: number;
}

interface FolderNode {
  key: string;
  id: string;
  title: string;
  icon: ReactNode;
  arrangement: Arrangement;
  actions: FolderAction[];
  defaultActive: boolean;
  defaultCollapsed: boolean;
  hideTitle: boolean;
  order: number;
  size?: number;
  folders: FolderNode[];
  fields: SlotRecord[];
  fieldSegments: Map<string, FieldSegment>;
}

type LayoutItem =
  | { type: 'field'; key: string; order: number; size?: number; slot: SlotRecord; title: string }
  | { type: 'folder'; key: string; node: FolderNode; order: number; size?: number; title: string };

interface EditorContextValue {
  root: EditorRoot;
  slots: Map<string, SlotRecord>;
  targets: Map<string, HTMLElement>;
  targetVersion: number;
  registerSlot(record: SlotRecord): () => void;
  registerTarget(slotId: string, element: HTMLElement | null): void;
}

export interface EditorTheme {
  color: {
    bg: string;
    bgSoft: string;
    bgHover: string;
    border: string;
    borderStrong: string;
    guide: string;
    fg: string;
    muted: string;
    subtle: string;
    accent: string;
  };
  radius: { sm: number; md: number };
  font: { sans: string; mono: string };
}

export type PartialEditorTheme = {
  color?: Partial<EditorTheme['color']>;
  radius?: Partial<EditorTheme['radius']>;
  font?: Partial<EditorTheme['font']>;
};

export const defaultTheme: EditorTheme = {
  color: {
    bg: '#ffffff',
    bgSoft: '#f7f7f8',
    bgHover: '#f0f0f1',
    border: '#e3e3e6',
    borderStrong: '#c9c9cf',
    guide: '#ededf0',
    fg: '#111113',
    muted: '#63636b',
    subtle: '#9a9aa2',
    accent: '#2563eb',
  },
  radius: { sm: 4, md: 6 },
  font: {
    sans: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Inter", "SF Pro Text", system-ui, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, "JetBrains Mono", monospace',
  },
};

function mergeTheme(theme?: PartialEditorTheme): EditorTheme {
  return {
    color: { ...defaultTheme.color, ...theme?.color },
    radius: { ...defaultTheme.radius, ...theme?.radius },
    font: { ...defaultTheme.font, ...theme?.font },
  };
}

const t = defaultTheme;
const styles = {
  editor: css({
    height: '100%',
    width: '100%',
    color: t.color.fg,
    background: t.color.bg,
    fontFamily: t.font.sans,
    fontSize: 12,
    overflow: 'hidden',
  }),
  contributionRoot: css({ display: 'none' }),
  folder: css({
    minWidth: 0,
    minHeight: 0,
    background: t.color.bg,
    '&[data-fill="true"]': {
      height: '100%',
      width: '100%',
      maxWidth: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    },
    '&[data-fill="true"] > :not(header)': {
      flex: '1 1 auto',
      minWidth: 0,
      minHeight: 0,
    },
  }),
  folderRoot: css({ height: '100%' }),
  folderIcon: css({
    display: 'inline-grid',
    placeItems: 'center',
    width: 18,
    minWidth: 18,
    height: 18,
    borderRadius: 3,
    color: 'inherit',
    '& svg': { width: 14, height: 14, strokeWidth: 1.8 },
  }),
  folderHeader: css({
    minHeight: 28,
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '0 8px',
    background: t.color.bg,
  }),
  folderTitle: css({
    flex: '1 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: 600,
  }),
  folderActions: css({ display: 'flex', alignItems: 'center', gap: 2 }),
  iconButton: css({
    border: 0,
    background: 'transparent',
    color: t.color.subtle,
    display: 'grid',
    placeItems: 'center',
    width: 24,
    height: 24,
    padding: 0,
    borderRadius: t.radius.sm,
    cursor: 'pointer',
    '&:hover, &[data-state="open"]': { background: t.color.bgHover, color: t.color.fg },
    '&:disabled': { cursor: 'not-allowed', opacity: 0.45 },
    '& svg': { width: 14, height: 14, strokeWidth: 1.9 },
  }),
  tooltip: css({
    zIndex: 80,
    maxWidth: 220,
    border: `1px solid ${t.color.border}`,
    borderRadius: 5,
    background: '#18181b',
    color: '#ffffff',
    padding: '5px 7px',
    font: `500 11px/1.2 ${t.font.sans}`,
    boxShadow: '0 8px 24px rgba(17, 17, 19, 0.18)',
  }),
  menu: css({
    zIndex: 90,
    minWidth: 160,
    border: `1px solid ${t.color.border}`,
    borderRadius: t.radius.md,
    background: t.color.bg,
    padding: 4,
    fontFamily: t.font.sans,
    fontSize: 12,
    lineHeight: 1.2,
    boxShadow: '0 14px 32px rgba(17, 17, 19, 0.14)',
  }),
  menuItem: css({
    minHeight: 28,
    display: 'grid',
    gridTemplateColumns: '18px minmax(0, 1fr)',
    alignItems: 'center',
    gap: 7,
    borderRadius: t.radius.sm,
    color: t.color.fg,
    padding: '0 7px',
    outline: 'none',
    cursor: 'default',
    '&[data-highlighted]': { background: t.color.bgHover },
    '&[data-disabled]': { color: t.color.subtle },
  }),
  menuIcon: css({ display: 'grid', placeItems: 'center', color: t.color.muted, '& svg': { width: 14, height: 14 } }),
  navLayout: css({
    height: '100%',
    minHeight: 0,
    minWidth: 0,
    display: 'grid',
    background: t.color.bg,
    '&[data-placement="left"]': { gridTemplateColumns: 'auto minmax(0, 1fr)' },
    '&[data-placement="top"]': { gridTemplateRows: 'auto minmax(0, 1fr)' },
    '&[data-placement="bottom"]': { gridTemplateRows: 'minmax(0, 1fr) auto' },
  }),
  navContent: css({ minHeight: 0, minWidth: 0, overflow: 'hidden' }),
  nav: css({
    background: t.color.bg,
    display: 'flex',
    gap: 4,
    padding: 6,
    overflow: 'auto',
    '&[data-placement="left"]': {
      width: 132,
      borderRight: `1px solid ${t.color.border}`,
      flexDirection: 'column',
    },
    '&[data-placement="left"][data-icons-only="true"]': { width: 72, alignItems: 'center', gap: 9, overflow: 'visible' },
    '&[data-placement="top"]': { borderBottom: `1px solid ${t.color.border}`, alignItems: 'center' },
    '&[data-placement="bottom"]': { borderTop: `1px solid ${t.color.border}`, alignItems: 'center' },
  }),
  navItem: css({
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'center',
    borderRadius: t.radius.md,
    color: t.color.muted,
    minWidth: 0,
    '&:hover': { background: t.color.bgHover, color: t.color.fg },
    '&[data-active="true"]': { color: t.color.accent },
  }),
  navTrigger: css({
    minWidth: 0,
    width: '100%',
    border: 0,
    background: 'transparent',
    color: 'inherit',
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '6px 8px',
    borderRadius: t.radius.md,
    cursor: 'pointer',
    textAlign: 'left',
    '&:focus-visible': { outline: `2px solid ${t.color.borderStrong}`, outlineOffset: 1 },
  }),
  navLabel: css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
  navItemActions: css({ display: 'flex', alignItems: 'center' }),
  tabs: css({ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }),
  tabbar: css({ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 6px 0', borderBottom: `1px solid ${t.color.border}` }),
  tab: css({
    border: 0,
    background: 'transparent',
    color: t.color.muted,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 9px',
    borderRadius: `${t.radius.md}px ${t.radius.md}px 0 0`,
    cursor: 'pointer',
    '&[data-state="active"]': { color: t.color.fg, background: t.color.bgSoft },
  }),
  tabbarActions: css({ padding: '4px 6px', borderBottom: `1px solid ${t.color.border}` }),
  tabPanel: css({ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }),
  dropdown: css({ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }),
  dropdownBar: css({ display: 'flex', alignItems: 'center', gap: 6, padding: 6, borderBottom: `1px solid ${t.color.border}` }),
  dropdownTrigger: css({
    border: `1px solid ${t.color.border}`,
    background: t.color.bg,
    color: t.color.fg,
    borderRadius: t.radius.md,
    minHeight: 30,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 8px',
    cursor: 'pointer',
  }),
  dropdownMenu: css({ zIndex: 90, minWidth: 180, border: `1px solid ${t.color.border}`, borderRadius: t.radius.md, background: t.color.bg, padding: 4, boxShadow: '0 14px 32px rgba(17, 17, 19, 0.14)' }),
  dropdownItem: css({ minHeight: 28, display: 'flex', alignItems: 'center', gap: 7, padding: '0 7px', borderRadius: t.radius.sm, outline: 'none', '&[data-highlighted]': { background: t.color.bgHover } }),
  dropdownActions: css({ marginLeft: 'auto' }),
  dropdownPanel: css({ flex: '1 1 auto', minHeight: 0, overflow: 'auto', '&[data-fill="true"]': { overflow: 'hidden' } }),
  accordion: css({ minHeight: 0, overflow: 'auto' }),
  accordionItem: css({ borderBottom: `1px solid ${t.color.border}` }),
  accordionHeading: css({ display: 'flex', alignItems: 'center', paddingRight: 6 }),
  accordionTrigger: css({
    flex: '1 1 auto',
    border: 0,
    background: 'transparent',
    color: t.color.fg,
    minHeight: 34,
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '0 8px',
    cursor: 'pointer',
    '&[data-state="open"] svg:last-child': { transform: 'rotate(90deg)' },
  }),
  accordionChevron: css({ marginLeft: 'auto', transition: 'transform 120ms ease' }),
  accordionContent: css({ padding: '4px 8px 8px' }),
  dockShell: css({ height: '100%', minHeight: 0, minWidth: 0, overflow: 'hidden' }),
  dock: css({ height: '100%', minHeight: 0, minWidth: 0 }),
  dockCell: css({ minWidth: 0, minHeight: 0, overflow: 'hidden' }),
  resizeHandle: css({
    position: 'relative',
    background: t.color.guide,
    '&[data-axis="horizontal"]': { width: 1, cursor: 'col-resize' },
    '&[data-axis="vertical"]': { height: 1, cursor: 'row-resize' },
  }),
  stack: css({ boxSizing: 'border-box', display: 'grid', gap: 8, padding: 8, overflow: 'auto', '&[data-fill="true"]': { height: '100%', overflow: 'hidden' } }),
  layerStack: css({ display: 'grid', width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden' }),
  layerStackLayer: css({
    gridArea: '1 / 1',
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
    pointerEvents: 'none',
    '&[data-interactive="true"]': { pointerEvents: 'auto' },
  }),
  grid: css({ boxSizing: 'border-box', display: 'grid', gap: 8, padding: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', overflow: 'auto' }),
  gridCell: css({ minWidth: 0, minHeight: 0 }),
  fields: css({ boxSizing: 'border-box', display: 'grid', gap: 8, padding: 8, '&[data-fill="true"]': { height: '100%', padding: 0 } }),
  fieldHost: css({
    minWidth: 0,
    display: 'grid',
    gap: 5,
    '&[data-hidden="true"]': { display: 'none' },
    '&[data-fill="true"]': { height: '100%', minHeight: 0 },
    '&[data-unstyled="true"]': { padding: 0, gap: 0 },
  }),
  fieldHostLabel: css({ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, color: t.color.muted, fontWeight: 500 }),
  fieldHostContent: css({ minWidth: 0, minHeight: 0, overflow: 'hidden', '[data-fill="true"] > &': { height: '100%' } }),
  input: css({
    width: '100%',
    boxSizing: 'border-box',
    border: `1px solid ${t.color.border}`,
    borderRadius: t.radius.sm,
    background: t.color.bg,
    color: t.color.fg,
    font: 'inherit',
    padding: '6px 7px',
    '&:focus': { outline: `2px solid ${t.color.bgHover}`, borderColor: t.color.borderStrong },
  }),
  color: css({ height: 28, padding: 2 }),
  toggle: css({ display: 'inline-flex', alignItems: 'center', gap: 6, color: t.color.muted }),
  vector: css({ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4 }),
};

const EditorContext = createContext<EditorContextValue | null>(null);

let nextSourceOrder = 0;
const DOCK_ROW_WRAP_WIDTH = 520;

function useEditor(): EditorContextValue {
  const context = useContext(EditorContext);
  if (!context) throw new Error('Editor editor primitives must be used inside <Editor>.');
  return context;
}

export function Editor({ root, children }: { root: EditorRoot; children: ReactNode }) {
  const [slots, setSlots] = useState<Map<string, SlotRecord>>(() => new Map());
  const [targetVersion, setTargetVersion] = useState(0);
  const targetsRef = useRef(new Map<string, HTMLElement>());

  const registerSlot = useCallback((record: SlotRecord) => {
    setSlots((current) => {
      const next = new Map(current);
      next.set(record.id, record);
      return next;
    });
    return () => {
      setSlots((current) => {
        const next = new Map(current);
        next.delete(record.id);
        return next;
      });
      targetsRef.current.delete(record.id);
      setTargetVersion((value) => value + 1);
    };
  }, []);

  const registerTarget = useCallback((slotId: string, element: HTMLElement | null) => {
    const current = targetsRef.current.get(slotId);
    if (element) {
      if (current === element) return;
      targetsRef.current.set(slotId, element);
    } else {
      if (!current) return;
      targetsRef.current.delete(slotId);
    }
    setTargetVersion((value) => value + 1);
  }, []);

  const value = useMemo<EditorContextValue>(() => ({
    root,
    slots,
    targets: targetsRef.current,
    targetVersion,
    registerSlot,
    registerTarget,
  }), [root, slots, targetVersion, registerSlot, registerTarget]);

  return (
    <EditorContext.Provider value={value}>
      <Tooltip.Provider delayDuration={300} skipDelayDuration={150}>
        <div className={styles.editor}>
          <Workbench />
          <div className={styles.contributionRoot}>{children}</div>
        </div>
      </Tooltip.Provider>
    </EditorContext.Provider>
  );
}

export function Slot({ path, children }: { path: SlotPath; children: ReactNode }) {
  const id = useId();
  const editor = useEditor();
  const recordRef = useRef<SlotRecord>({
    id,
    path,
    sourceOrder: nextSourceOrder++,
    contentVersion: 0,
  });

  recordRef.current.path = path;
  recordRef.current.contentVersion += 1;

  useEffect(() => editor.registerSlot(recordRef.current), [editor.registerSlot]);

  const target = editor.targets.get(id);
  void editor.targetVersion;
  return target ? createPortal(children, target) : null;
}

function Workbench() {
  const editor = useEditor();
  const tree = useMemo(() => buildTree(editor.root, [...editor.slots.values()]), [editor.root, editor.slots]);
  return <FolderRenderer node={tree} parentKey="__root__" isRoot />;
}

function buildTree(root: EditorRoot, slots: SlotRecord[]): FolderNode {
  const rootNode = createFolderNode({
    id: root.id ?? slug(root.title),
    title: root.title,
    icon: root.icon,
    arrangement: root.arrangement,
  }, 'root');

  const folderLookup = new Map<string, FolderNode>([[rootNode.key, rootNode]]);

  for (const slot of slots) {
    let parent = rootNode;
    let parentKey = rootNode.key;
    const folders = slot.path.slice(0, -1) as FolderSegment[];
    for (const segment of folders) {
      const id = segment.id ?? slug(segment.title);
      const key = `${parentKey}/${id}`;
      let node = folderLookup.get(key);
      if (!node) {
        node = createFolderNode(segment, key);
        folderLookup.set(key, node);
        parent.folders.push(node);
      } else {
        node = mergeFolderNode(node, segment);
      }
      parent = node;
      parentKey = key;
    }

    const leaf = slot.path[slot.path.length - 1] as FieldSegment;
    parent.fields.push(slot);
    parent.fieldSegments.set(slot.id, leaf);
  }

  sortTree(rootNode);
  return rootNode;
}

function createFolderNode(segment: FolderSegment, key: string): FolderNode {
  return {
    key,
    id: segment.id ?? slug(segment.title),
    title: segment.title,
    icon: segment.icon,
    arrangement: segment.arrangement,
    actions: [...(segment.actions ?? [])],
    defaultActive: segment.defaultActive ?? false,
    defaultCollapsed: segment.defaultCollapsed ?? false,
    hideTitle: segment.hideTitle ?? false,
    order: segment.order ?? Number.POSITIVE_INFINITY,
    size: segment.size,
    folders: [],
    fields: [],
    fieldSegments: new Map(),
  };
}

function mergeFolderNode(node: FolderNode, segment: FolderSegment): FolderNode {
  return {
    ...node,
    title: segment.title,
    icon: segment.icon,
    arrangement: segment.arrangement,
    actions: mergeActions(node.actions, segment.actions ?? []),
    defaultActive: segment.defaultActive ?? node.defaultActive,
    defaultCollapsed: segment.defaultCollapsed ?? node.defaultCollapsed,
    hideTitle: segment.hideTitle ?? node.hideTitle,
    order: segment.order ?? node.order,
    size: segment.size ?? node.size,
  };
}

function sortTree(node: FolderNode): void {
  node.folders.sort(compareByTitle);
  node.fields.sort((a, b) => {
    const aSegment = node.fieldSegments.get(a.id);
    const bSegment = node.fieldSegments.get(b.id);
    return compareTitleValues(aSegment?.title, bSegment?.title) || a.sourceOrder - b.sourceOrder;
  });
  for (const child of node.folders) sortTree(child);
}

function compareByTitle(a: FolderNode, b: FolderNode): number {
  const order = a.order - b.order;
  if (order !== 0) return order;
  return compareTitleValues(a.title, b.title) || a.id.localeCompare(b.id);
}

function compareTitleValues(a: string | undefined, b: string | undefined): number {
  return (a ?? '').localeCompare(b ?? '', undefined, { numeric: true, sensitivity: 'base' });
}

function FolderRenderer({
  node,
  parentKey,
  isRoot = false,
}: {
  node: FolderNode;
  parentKey: string;
  isRoot?: boolean;
}) {
  const onlyChild = isRoot ? null : singleRenderableChild(node);
  if (onlyChild) return <LayoutItemRenderer item={onlyChild} parentKey={parentKey} />;

  const className = cx(styles.folder, isRoot && styles.folderRoot);
  const hasFill = folderHasFill(node);

  return (
    <section className={className} data-fill={hasFill ? 'true' : 'false'}>
      {!isRoot && !node.hideTitle && node.title.trim() ? <FolderHeader node={node} /> : null}
      <FolderBody node={node} />
    </section>
  );
}

function singleRenderableChild(node: FolderNode): LayoutItem | null {
  if (node.actions.length > 0) return null;
  const items = layoutItems(node);
  return items.length === 1 ? items[0]! : null;
}

function folderHasFill(node: FolderNode): boolean {
  return node.fields.some((slot) => node.fieldSegments.get(slot.id)?.fill)
    || node.folders.some((folder) => folderHasFill(folder));
}

function FolderBody({ node }: { node: FolderNode }) {
  return <ArrangementRenderer node={node} />;
}

function FolderHeader({ node }: { node: FolderNode }) {
  return (
    <header className={styles.folderHeader}>
      <span className={styles.folderIcon}>{node.icon}</span>
      <span className={styles.folderTitle}>{node.title}</span>
      <FolderActionButtons actions={node.actions} />
    </header>
  );
}

function mergeActions(current: FolderAction[], incoming: readonly FolderAction[]): FolderAction[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((action) => [action.id, action]));
  for (const action of incoming) byId.set(action.id, action);
  return [...byId.values()];
}

function FolderActionButtons({ actions }: { actions: FolderAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className={styles.folderActions}>
      {actions.map((action) => {
        const icon = renderActionIcon(action.icon);
        return (
          <Tooltip.Root key={action.id}>
            <Tooltip.Trigger asChild>
              <button
                aria-label={action.label}
                className={styles.iconButton}
                disabled={action.disabled}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  action.run();
                }}
              >
                {icon}
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className={styles.tooltip} sideOffset={7}>
                {action.label}
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        );
      })}
    </div>
  );
}

function FolderActionMenu({ actions }: { actions: FolderAction[] }) {
  if (actions.length === 0) return null;
  return (
    <DropdownMenu.Root>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <DropdownMenu.Trigger asChild>
            <button aria-label="Folder actions" className={styles.iconButton} type="button">
              <MoreHorizontal aria-hidden />
            </button>
          </DropdownMenu.Trigger>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className={styles.tooltip} sideOffset={7}>
            Folder actions
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" className={styles.menu} sideOffset={7}>
          {actions.map((action) => (
            <DropdownMenu.Item
              className={styles.menuItem}
              disabled={action.disabled}
              key={action.id}
              onSelect={(event) => {
                event.preventDefault();
                action.run();
              }}
            >
              <span className={styles.menuIcon}>{renderActionIcon(action.icon)}</span>
              <span>{action.label}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function renderActionIcon(icon: FolderAction['icon']): ReactNode {
  if (isValidElement(icon)) return icon;
  if (typeof icon === 'function' || (icon && typeof icon === 'object' && '$$typeof' in icon)) {
    const Icon = icon as ElementType;
    return <Icon aria-hidden />;
  }
  return icon as ReactNode;
}

function ArrangementRenderer({ node }: { node: FolderNode }) {
  return (
    <>
      {node.arrangement === 'tabs' && <TabsArrangement node={node} />}
      {node.arrangement === 'dropdown' && <DropdownArrangement node={node} />}
      {node.arrangement === 'nav-left' && <NavArrangement iconsOnly={false} node={node} placement="left" />}
      {node.arrangement === 'nav-left-icons' && <NavArrangement iconsOnly node={node} placement="left" />}
      {node.arrangement === 'nav-top' && <NavArrangement iconsOnly={false} node={node} placement="top" />}
      {node.arrangement === 'nav-top-icons' && <NavArrangement iconsOnly node={node} placement="top" />}
      {node.arrangement === 'nav-bottom' && <NavArrangement iconsOnly={false} node={node} placement="bottom" />}
      {node.arrangement === 'accordion' && <AccordionArrangement node={node} />}
      {node.arrangement === 'dock-row' && <DockArrangement node={node} direction="horizontal" />}
      {node.arrangement === 'dock-column' && <DockArrangement node={node} direction="vertical" />}
      {node.arrangement === 'layer-stack' && <LayerStackArrangement node={node} />}
      {node.arrangement === 'stack' && <StackArrangement node={node} />}
      {node.arrangement === 'grid' && <GridArrangement node={node} />}
    </>
  );
}

function NavArrangement({
  iconsOnly,
  node,
  placement,
}: {
  iconsOnly: boolean;
  node: FolderNode;
  placement: 'bottom' | 'left' | 'top';
}) {
  const folders = node.folders;
  const [active, setActive] = useState(() => folders.find((folder) => folder.defaultActive)?.key ?? folders[0]?.key ?? '');
  useEffect(() => {
    if (folders.length === 0) return;
    if (folders.some((folder) => folder.key === active)) return;
    setActive(folders.find((folder) => folder.defaultActive)?.key ?? folders[0]?.key ?? '');
  }, [active, folders]);
  const activeFolder = folders.find((folder) => folder.key === active) ?? folders[0];
  const list = (
    <Tabs.List aria-label={node.title} className={styles.nav} data-icons-only={iconsOnly} data-placement={placement}>
      {folders.map((folder) => (
        <NavItem
          active={folder.key === activeFolder?.key}
          folder={folder}
          iconsOnly={iconsOnly}
          key={folder.key}
          placement={placement}
        />
      ))}
    </Tabs.List>
  );

  return (
    <Tabs.Root
      className={styles.navLayout}
      data-icons-only={iconsOnly}
      data-placement={placement}
      value={activeFolder?.key ?? ''}
      onValueChange={setActive}
    >
      {placement !== 'bottom' && list}
      <Tabs.Content className={styles.navContent} forceMount value={activeFolder?.key ?? ''}>
        {activeFolder && <FolderRenderer node={activeFolder} parentKey={node.key} isRoot />}
      </Tabs.Content>
      {placement === 'bottom' && list}
    </Tabs.Root>
  );
}

function NavItem({
  active,
  folder,
  iconsOnly,
  placement,
}: {
  active: boolean;
  folder: FolderNode;
  iconsOnly: boolean;
  placement: 'bottom' | 'left' | 'top';
}) {
  const trigger = (
    <Tabs.Trigger
      aria-label={iconsOnly ? folder.title : undefined}
      className={styles.navTrigger}
      data-active={active}
      value={folder.key}
    >
      <span className={styles.folderIcon}>{folder.icon}</span>
      <span className={styles.navLabel}>{folder.title}</span>
    </Tabs.Trigger>
  );

  return (
    <div className={styles.navItem} data-active={active} data-icons-only={iconsOnly}>
      {iconsOnly ? (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>{trigger}</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className={styles.tooltip} side={placement === 'left' ? 'right' : placement === 'top' ? 'bottom' : 'top'} sideOffset={10}>
              {folder.title}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      ) : trigger}
      <div className={styles.navItemActions}>
        {iconsOnly ? <FolderActionMenu actions={folder.actions} /> : <FolderActionButtons actions={folder.actions} />}
      </div>
    </div>
  );
}

function TabsArrangement({ node }: { node: FolderNode }) {
  const folders = node.folders;
  const [active, setActive] = useState(() => folders.find((folder) => folder.defaultActive)?.key ?? folders[0]?.key ?? '');
  useEffect(() => {
    if (folders.length === 0) return;
    if (folders.some((folder) => folder.key === active)) return;
    setActive(folders.find((folder) => folder.defaultActive)?.key ?? folders[0]?.key ?? '');
  }, [active, folders]);
  const activeFolder = folders.find((folder) => folder.key === active) ?? folders[0];
  if (node.fields.length === 0 && folders.length === 1) {
    return <FolderBody node={folders[0]} />;
  }
  return (
    <Tabs.Root className={styles.tabs} value={activeFolder?.key ?? ''} onValueChange={setActive}>
      <FieldList node={node} />
      <Tabs.List aria-label={node.title} className={styles.tabbar}>
        {folders.map((folder) => (
          <Tabs.Trigger className={styles.tab} key={folder.key} value={folder.key}>
            <span className={styles.folderIcon}>{folder.icon}</span>
            {folder.title}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {activeFolder && activeFolder.actions.length > 0 && (
        <div className={styles.tabbarActions}>
          <FolderActionButtons actions={activeFolder.actions} />
        </div>
      )}
      <Tabs.Content className={styles.tabPanel} forceMount value={activeFolder?.key ?? ''}>
        {activeFolder && <FolderBody node={activeFolder} />}
      </Tabs.Content>
    </Tabs.Root>
  );
}

function DropdownArrangement({ node }: { node: FolderNode }) {
  const folders = node.folders;
  const [active, setActive] = useState(() => folders.find((folder) => folder.defaultActive)?.key ?? folders[0]?.key ?? '');
  useEffect(() => {
    if (folders.length === 0) return;
    if (folders.some((folder) => folder.key === active)) return;
    setActive(folders.find((folder) => folder.defaultActive)?.key ?? folders[0]?.key ?? '');
  }, [active, folders]);
  const activeFolder = folders.find((folder) => folder.key === active) ?? folders[0];

  return (
    <div className={styles.dropdown}>
      <FieldList node={node} />
      <div className={styles.dropdownBar}>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              aria-label={node.title ? `Select ${node.title}` : 'Select folder'}
              className={styles.dropdownTrigger}
              type="button"
            >
              {activeFolder?.icon ? <span className={styles.folderIcon}>{activeFolder.icon}</span> : null}
              <span>{activeFolder?.title ?? 'Select'}</span>
              <ChevronDown aria-hidden />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="start" className={styles.dropdownMenu} sideOffset={6}>
              {folders.map((folder) => (
                <DropdownMenu.Item
                  className={styles.dropdownItem}
                  key={folder.key}
                  onSelect={() => setActive(folder.key)}
                >
                  {folder.icon ? <span className={styles.folderIcon}>{folder.icon}</span> : null}
                  <span>{folder.title}</span>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <div className={styles.dropdownActions}>
          {activeFolder ? <FolderActionButtons actions={activeFolder.actions} /> : null}
        </div>
      </div>
      <div className={styles.dropdownPanel} data-fill={activeFolder && folderHasFill(activeFolder) ? 'true' : 'false'}>
        {activeFolder ? <FolderBody node={activeFolder} /> : null}
      </div>
    </div>
  );
}

function AccordionArrangement({ node }: { node: FolderNode }) {
  const folders = node.folders;
  return (
    <Accordion.Root
      className={styles.accordion}
      defaultValue={folders.filter((folder) => !folder.defaultCollapsed).map((folder) => folder.key)}
      type="multiple"
    >
      <FieldList node={node} />
      {folders.map((folder) => (
        <Accordion.Item className={styles.accordionItem} key={folder.key} value={folder.key}>
          <div className={styles.accordionHeading}>
            <Accordion.Trigger className={styles.accordionTrigger}>
              <span className={styles.folderIcon}>{folder.icon}</span>
              <span>{folder.title}</span>
              <ChevronRight className={styles.accordionChevron} aria-hidden />
            </Accordion.Trigger>
            <FolderActionButtons actions={folder.actions} />
          </div>
          <Accordion.Content className={styles.accordionContent}>
            <FolderBody node={folder} />
          </Accordion.Content>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  );
}

function DockArrangement({ node, direction }: { node: FolderNode; direction: 'horizontal' | 'vertical' }) {
  const items = layoutItems(node);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const shellWidth = useElementWidth(shellRef);
  const effectiveDirection = direction === 'horizontal' && shellWidth > 0 && shellWidth < DOCK_ROW_WRAP_WIDTH
    ? 'vertical'
    : direction;

  return (
    <div
      className={styles.dockShell}
      data-direction={effectiveDirection}
      data-source-direction={direction}
      ref={shellRef}
    >
      <Group
        key={`${node.key}-${effectiveDirection}`}
        className={styles.dock}
        orientation={effectiveDirection}
        resizeTargetMinimumSize={{ coarse: 37, fine: 16 }}
      >
        {items.map((item, index) => (
          <Fragment key={item.key}>
            <Panel
              className={styles.dockCell}
              defaultSize={`${item.size ?? 100 / Math.max(items.length, 1)}%`}
              minSize="12%"
            >
              <LayoutItemRenderer item={item} parentKey={node.key} />
            </Panel>
            {index < items.length - 1 && (
              <Separator
                aria-label="Resize folder"
                className={styles.resizeHandle}
                data-axis={effectiveDirection}
              />
            )}
          </Fragment>
        ))}
      </Group>
    </div>
  );
}

function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const updateWidth = () => setWidth(Math.round(element.getBoundingClientRect().width));
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

function StackArrangement({ node }: { node: FolderNode }) {
  const items = layoutItems(node);
  return (
    <div className={styles.stack} data-fill={folderHasFill(node) ? 'true' : 'false'}>
      {items.map((item) => <LayoutItemRenderer item={item} parentKey={node.key} key={item.key} />)}
    </div>
  );
}

function LayerStackArrangement({ node }: { node: FolderNode }) {
  const items = layoutItems(node);
  return (
    <div className={styles.layerStack}>
      {items.map((item) => {
        const segment = item.type === 'field' ? node.fieldSegments.get(item.slot.id) : undefined;
        return (
          <div
            className={styles.layerStackLayer}
            data-interactive={segment?.interactive ?? true ? 'true' : 'false'}
            key={item.key}
          >
            <LayoutItemRenderer item={item} parentKey={node.key} />
          </div>
        );
      })}
    </div>
  );
}

function GridArrangement({ node }: { node: FolderNode }) {
  const items = layoutItems(node);
  return (
    <div className={styles.grid}>
      {items.map((item) => (
        <div className={styles.gridCell} key={item.key}>
          <LayoutItemRenderer item={item} parentKey={node.key} />
        </div>
      ))}
    </div>
  );
}

function layoutItems(node: FolderNode): LayoutItem[] {
  return [
    ...node.folders.map((folder): LayoutItem => ({
      type: 'folder',
      key: folder.key,
      node: folder,
      order: folder.order,
      size: folder.size,
      title: folder.title,
    })),
    ...node.fields.map((slot): LayoutItem => {
      const segment = node.fieldSegments.get(slot.id);
      return {
        type: 'field',
        key: slot.id,
        order: segment?.order ?? Number.POSITIVE_INFINITY,
        size: segment?.size,
        slot,
        title: segment?.title ?? '',
      };
    }),
  ].sort((a, b) => {
    const order = a.order - b.order;
    if (order !== 0) return order;
    return compareTitleValues(a.title, b.title) || a.key.localeCompare(b.key);
  });
}

function LayoutItemRenderer({ item, parentKey }: { item: LayoutItem; parentKey: string }) {
  if (item.type === 'folder') return <FolderRenderer node={item.node} parentKey={parentKey} />;
  return <FieldHost segment={item.slot.path[item.slot.path.length - 1] as FieldSegment} slotId={item.slot.id} />;
}

function FieldList({ node }: { node: FolderNode }) {
  if (node.fields.length === 0) return null;
  const hasFillField = node.fields.some((slot) => node.fieldSegments.get(slot.id)?.fill);
  return (
    <div className={styles.fields} data-fill={hasFillField ? 'true' : 'false'}>
      {node.fields.map((slot) => {
        const segment = node.fieldSegments.get(slot.id);
        return <FieldHost segment={segment} slotId={slot.id} key={slot.id} />;
      })}
    </div>
  );
}

function FieldHost({ segment, slotId }: { segment: FieldSegment | undefined; slotId: string }) {
  const { registerTarget } = useEditor();
  const setTarget = useCallback((element: HTMLDivElement | null) => {
    registerTarget(slotId, element);
  }, [registerTarget, slotId]);

  return (
    <div
      className={styles.fieldHost}
      data-align={segment?.align ?? 'stretch'}
      data-fill={segment?.fill ? 'true' : 'false'}
      data-hidden={segment?.hidden ? 'true' : 'false'}
      data-show-label={segment?.fill ? 'false' : 'true'}
      data-unstyled={segment?.unstyled ? 'true' : 'false'}
    >
      {segment?.fill ? null : (
        <div className={styles.fieldHostLabel}>
          {segment?.icon && <span className={styles.folderIcon}>{segment.icon}</span>}
          <span>{segment?.title}</span>
        </div>
      )}
      <div className={styles.fieldHostContent} ref={setTarget} />
    </div>
  );
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'untitled';
}

export function StringField({
  path,
  value,
  onCommit,
  placeholder,
}: {
  path: SlotPath;
  value: string;
  onCommit?: (value: string) => void;
  placeholder?: string;
}) {
  const draft = useCommitDraft(value, onCommit);
  return (
    <Slot path={path}>
      <input
        className={styles.input}
        value={draft.value}
        placeholder={placeholder}
        onChange={(event) => draft.setValue(event.currentTarget.value)}
        onBlur={() => draft.commit()}
        onKeyDown={draft.onKeyDown}
      />
    </Slot>
  );
}

export function NumberField({
  path,
  value,
  onCommit,
  min,
  max,
  step = 1,
}: {
  path: SlotPath;
  value: number;
  onCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const draft = useCommitDraft(String(value), (next) => {
    const parsed = Number(next);
    if (Number.isFinite(parsed)) onCommit?.(parsed);
  });
  return (
    <Slot path={path}>
      <input
        className={styles.input}
        type="number"
        value={draft.value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => draft.setValue(event.currentTarget.value)}
        onBlur={(event) => draft.commit(event.currentTarget.value)}
        onPointerUp={(event) => draft.commit(event.currentTarget.value)}
        onKeyDown={draft.onKeyDown}
      />
    </Slot>
  );
}

export function BooleanField({
  path,
  value,
  onCommit,
}: {
  path: SlotPath;
  value: boolean;
  onCommit?: (value: boolean) => void;
}) {
  return (
    <Slot path={path}>
      <label className={styles.toggle}>
        <input type="checkbox" checked={value} onChange={(event) => onCommit?.(event.currentTarget.checked)} />
        <span>{value ? 'On' : 'Off'}</span>
      </label>
    </Slot>
  );
}

export function ColorField({
  path,
  value,
  onCommit,
}: {
  path: SlotPath;
  value: string;
  onCommit?: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const draft = useCommitDraft(value, onCommit);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const commit = () => draft.commit(input.value);
    input.addEventListener('change', commit);
    return () => input.removeEventListener('change', commit);
  }, [draft.commit]);

  return (
    <Slot path={path}>
      <input
        className={cx(styles.input, styles.color)}
        ref={inputRef}
        type="color"
        value={draft.value}
        onBlur={(event) => draft.commit(event.currentTarget.value)}
        onChange={(event) => draft.setValue(event.currentTarget.value)}
        onInput={(event) => draft.setValue(event.currentTarget.value)}
        onKeyDown={draft.onKeyDown}
        onPointerUp={(event) => draft.commit(event.currentTarget.value)}
      />
    </Slot>
  );
}

function InlineNumberInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit?: (value: number) => void;
}) {
  const draft = useCommitDraft(String(value), (next) => {
    const parsed = Number(next);
    if (Number.isFinite(parsed)) onCommit?.(parsed);
  });

  return (
    <input
      className={styles.input}
      type="number"
      value={draft.value}
      onBlur={(event) => draft.commit(event.currentTarget.value)}
      onChange={(event) => draft.setValue(event.currentTarget.value)}
      onKeyDown={draft.onKeyDown}
      onPointerUp={(event) => draft.commit(event.currentTarget.value)}
    />
  );
}

export function Vector3Field({
  path,
  value,
  onCommit,
}: {
  path: SlotPath;
  value: [number, number, number];
  onCommit?: (value: [number, number, number]) => void;
}) {
  return (
    <Slot path={path}>
      <div className={styles.vector}>
        {value.map((item, index) => (
          <InlineNumberInput
            key={index}
            value={item}
            onCommit={(nextItem) => {
              const next = [...value] as [number, number, number];
              next[index] = nextItem;
              onCommit?.(next);
            }}
          />
        ))}
      </div>
    </Slot>
  );
}

function useCommitDraft<T extends string>(source: T, onCommit?: (value: T) => void) {
  const [value, setValue] = useState(source);
  useEffect(() => setValue(source), [source]);

  const commit = useCallback((nextValue?: string) => {
    const candidate = (nextValue ?? value) as T;
    if (candidate !== source) onCommit?.(candidate);
  }, [value, source, onCommit]);

  const revert = useCallback(() => setValue(source), [source]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === 'Enter') {
      commit(event.currentTarget.value);
      event.currentTarget.blur();
    }
    if (event.key === 'Escape') {
      revert();
      event.currentTarget.blur();
    }
  }, [commit, revert]);

  return { value, setValue, commit, revert, onKeyDown };
}
