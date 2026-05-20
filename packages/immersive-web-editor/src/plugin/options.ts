import type { Align, Arrangement } from '@immersive-web-editor/ui';
import type { ViteDevServer } from 'vite';

export interface InitialCommand {
  id: string;
  title: string;
  hint?: string;
  keybinding?: string;
  scope?: string;
}

export interface EditorPluginContext {
  server: ViteDevServer;
}

export interface EditorPlugin {
  name: string;
  client?: string;
  commands?: InitialCommand[];
  path?: EditorFolderPath;
  configureServer?(ctx: EditorPluginContext): void | Promise<void>;
}

export interface EditorBuildOptions {
  enabled?: boolean;
  previewUrl?: string;
}

export interface EditorRootPathSegment {
  id?: string;
  title: string;
  arrangement: Arrangement;
}

export interface EditorFolderPathSegment {
  id?: string;
  title: string;
  arrangement: Arrangement;
  defaultActive?: boolean;
  defaultCollapsed?: boolean;
  hideTitle?: boolean;
  preserveFolder?: boolean;
  preserveMountedChildren?: boolean;
  order?: number;
  size?: number;
}

export interface EditorFieldPathSegment {
  id?: string;
  title: string;
  align?: Align;
  fill?: boolean;
  hidden?: boolean;
  interactive?: boolean;
  order?: number;
  size?: number;
  unstyled?: boolean;
}

export type EditorSlotPath = readonly [EditorRootPathSegment, ...EditorFolderPathSegment[], EditorFieldPathSegment];
export type EditorFolderPath = readonly [EditorRootPathSegment, EditorFolderPathSegment, ...EditorFolderPathSegment[]];

export interface EditorOptions {
  previewPath?: EditorSlotPath;
  overlayPath?: EditorSlotPath;
  configPath?: EditorFolderPath;
  plugins?: EditorPlugin[];
  build?: EditorBuildOptions;
}

export const DEFAULT_PREVIEW_PATH: EditorSlotPath = [
  { id: 'editor-root', title: 'Editor', arrangement: 'dock-row' },
  { id: 'editor-preview', title: 'Preview', arrangement: 'layer-stack', hideTitle: true, order: 20, size: 52 },
  { id: 'editor-preview-frame', title: 'Preview Frame', fill: true, interactive: true, order: 0, unstyled: true },
];

export const DEFAULT_OVERLAY_PATH: EditorSlotPath = [
  { id: 'editor-root', title: 'Editor', arrangement: 'dock-row' },
  { id: 'editor-preview', title: 'Preview', arrangement: 'layer-stack', hideTitle: true, order: 20, size: 52 },
  { id: 'editor-preview-overlay', title: 'Overlay Canvas', fill: true, interactive: true, order: 10, unstyled: true },
];

export const DEFAULT_CONFIG_PATH: EditorFolderPath = [
  { id: 'editor-root', title: 'Editor', arrangement: 'dock-row' },
  { id: 'editor-config', title: 'Config', arrangement: 'accordion', hideTitle: true, order: 30, size: 24 },
];
