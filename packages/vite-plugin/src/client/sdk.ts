// Shared editor transport types. This file is imported as type-only by the
// editor shell and configurable runtime; it is not injected into app pages.

import type { ReactNode } from 'react';
import type { FieldSegment, FolderSegment, SlotPath } from 'immersive-web-editor';
import type { JsonValue } from '../rpc';

export type { JsonValue };

export interface CommandOptions {
  id: string;
  title: string;
  run: () => void | Promise<void>;
  hint?: string;
  keybinding?: string;
  scope?: string;
}

export interface FieldDescriptor {
  component: (props: {
    value: JsonValue;
    label: string;
    description?: string;
    props?: unknown;
    path: SlotPath;
    field: FieldDescriptor;
    configFolder: FolderSegment;
    dataPath: readonly (string | number)[];
    panelFolder: FolderSegment;
    viewPath: readonly (string | number | FolderSegment)[];
    setValue(value: JsonValue): void | Promise<void>;
    renderField(options: {
      dataPath: readonly (string | number)[];
      field: FieldDescriptor;
      key?: string | number;
      setValue(value: JsonValue): void | Promise<void>;
      value: JsonValue;
      viewPath: readonly (string | number | FolderSegment)[];
    }): ReactNode;
    folder(
      title: string | number,
      prefix: string,
      actions?: FolderSegment['actions'],
      arrangement?: FolderSegment['arrangement'],
      options?: Partial<Pick<FolderSegment, 'defaultActive' | 'defaultCollapsed' | 'icon' | 'order' | 'size'>>,
    ): FolderSegment;
    fieldSegment(title: string | number, id: string, options?: Pick<FieldSegment, 'fill' | 'hidden' | 'icon' | 'order' | 'size'>): FieldSegment;
    slotPath(parts: readonly (string | number | FolderSegment)[], leaf: FieldSegment): SlotPath;
    defaultValue(field: FieldDescriptor): JsonValue;
  }) => ReactNode;
  props?: unknown;
  defaultValue?: unknown;
  description?: string;
  label?: string;
  layout?: 'inline' | 'block';
}
