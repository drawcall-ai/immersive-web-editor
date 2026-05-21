import type { ComponentType } from 'react';
import type { FolderSegment } from '@immersive-web-editor/ui';
import type { FieldRegistration } from '../rpc';
import type { CommandOptions, FieldDescriptor } from './sdk';

export interface FieldActionOptions {
  id: string;
  label: string;
  icon?: ComponentType<any> | string;
  disabled?: boolean;
  run: () => void | Promise<void>;
}

export interface MountedFieldOptions {
  id: string;
  title: string;
  actions?: FieldActionOptions[];
  mount: (container: HTMLElement) => () => void;
}

export interface EditorPluginApi {
  addField(opts: MountedFieldOptions): () => void;
  removeField(id: string): void;
  addFieldComponent(name: string, component: FieldDescriptor['component']): () => void;
  removeFieldComponent(name: string): void;
  addCommand(opts: CommandOptions): () => void;
  removeCommand(id: string): void;
}

export type ContributionSource = Window | object;

export interface RuntimeField extends Omit<FieldRegistration, 'field'> {
  field: FieldDescriptor;
  source: Window;
}

export interface RuntimeMountedField {
  id: string;
  title: string;
  actions?: FieldActionOptions[];
  mount: MountedFieldOptions['mount'];
  path?: FolderSegment[];
  source: ContributionSource;
  order: number;
}

let nextSlotOrder = 0;

export const mountedFieldStore = {
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

export const fieldStore = {
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
  removeByModulePath(source: ContributionSource, modulePaths: readonly string[]): void {
    const changedPaths = new Set(modulePaths);
    let changed = false;
    for (const [id, fieldRegistration] of this.fields) {
      if (fieldRegistration.source !== source || !changedPaths.has(fieldRegistration.modulePath)) continue;
      this.fields.delete(id);
      changed = true;
    }
    if (changed) this.emit();
  },
  all(): RuntimeField[] {
    return [...this.fields.values()].sort((a, b) => {
      const fieldFolder = a.fieldFolder.localeCompare(b.fieldFolder, undefined, { numeric: true, sensitivity: 'base' });
      if (fieldFolder !== 0) return fieldFolder;
      return a.path.join('.').localeCompare(b.path.join('.'), undefined, { numeric: true, sensitivity: 'base' });
    });
  },
};
