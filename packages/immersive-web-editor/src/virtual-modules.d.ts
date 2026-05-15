declare module 'virtual:editor/config' {
  import type { CommandOptions } from './client/sdk';

  interface EditorPluginApi {
    addField(opts: {
      id: string;
      title: string;
      actions?: Array<{
        id: string;
        label: string;
        icon?: unknown;
        disabled?: boolean;
        run: () => void | Promise<void>;
      }>;
      mount: (container: HTMLElement) => (() => void) | void;
    }): () => void;
    removeField(id: string): void;
    addCommand(opts: CommandOptions): () => void;
    removeCommand(id: string): void;
  }

  export const previewUrl: string;
  export const pluginModules: Array<{
    name: string;
    module: {
      activate?: (editor: EditorPluginApi) => void | (() => void);
    };
  }>;
  export const pluginCommands: Array<{
    id: string;
    title: string;
    hint?: string;
    keybinding?: string;
    scope?: string;
  }>;
}
