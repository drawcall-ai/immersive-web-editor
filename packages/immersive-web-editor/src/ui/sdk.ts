// Shared editor transport types. This file is imported as type-only by the
// Editor UI and authoring runtime; it is not injected into app pages.

import type { ReactNode } from 'react';
import type { SlotSegment, FolderSegment, SlotPath } from '@immersive-web-editor/ui';
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
    fieldsFolder: FolderSegment;
    fieldsPath: readonly FolderSegment[];
    dataPath: readonly (string | number)[];
    fieldFolder: FolderSegment;
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
    renderSlot(children: ReactNode, path?: SlotPath): ReactNode;
    folder(
      title: string | number,
      prefix: string,
      actions?: FolderSegment['actions'],
      arrangement?: FolderSegment['arrangement'],
      options?: Partial<Pick<FolderSegment, 'defaultActive' | 'defaultCollapsed' | 'hideTitle' | 'icon' | 'preserveFolder' | 'preserveMountedChildren' | 'order' | 'size'>>,
    ): FolderSegment;
    slotSegment(
      title: string | number,
      id: string,
      options?: Partial<Pick<SlotSegment, 'fill' | 'hidden' | 'icon' | 'interactive' | 'order' | 'size' | 'unstyled'>>,
    ): SlotSegment;
    slotPath(parts: readonly (string | number | FolderSegment)[], leaf: SlotSegment): SlotPath;
    defaultValue(field: FieldDescriptor): JsonValue;
  }) => ReactNode;
  props?: unknown;
  defaultValue?: unknown;
  description?: string;
  label?: string;
  layout?: 'inline' | 'block';
}
