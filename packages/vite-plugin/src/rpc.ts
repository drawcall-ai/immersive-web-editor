export type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface EditorComponentRef {
  module: string;
  exportName: string;
}

export interface SerializedFieldDescriptor {
  component: EditorComponentRef;
  props?: JsonValue;
  defaultValue?: JsonValue;
  description?: string;
  label?: string;
  layout?: 'inline' | 'block';
}

export interface FieldRegistration {
  id: string;
  panel: string;
  path: string[];
  value: JsonValue;
  field: SerializedFieldDescriptor;
}

export type PreviewToEditorMessage =
  | {
    type: 'editor:addField';
    field: FieldRegistration;
  }
  | {
    type: 'editor:removeField';
    id: string;
  };

export function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return typeof value !== 'number' || Number.isFinite(value);
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).every(isJsonValue);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function isEditorComponentRef(value: unknown): value is EditorComponentRef {
  return isObject(value)
    && typeof value.module === 'string'
    && typeof value.exportName === 'string';
}

export function isSerializedFieldDescriptor(value: unknown): value is SerializedFieldDescriptor {
  if (!isObject(value) || !isEditorComponentRef(value.component)) return false;
  if ('props' in value && !isJsonValue(value.props)) return false;
  if ('defaultValue' in value && !isJsonValue(value.defaultValue)) return false;
  return true;
}

export function isFieldRegistration(value: unknown): value is FieldRegistration {
  return isObject(value)
    && typeof value.id === 'string'
    && typeof value.panel === 'string'
    && Array.isArray(value.path)
    && value.path.every((part) => typeof part === 'string')
    && isJsonValue(value.value)
    && isSerializedFieldDescriptor(value.field);
}

export function isPreviewToEditorMessage(value: unknown): value is PreviewToEditorMessage {
  if (!isObject(value) || typeof value.type !== 'string') return false;
  if (value.type === 'editor:addField') return isFieldRegistration(value.field);
  if (value.type === 'editor:removeField') return typeof value.id === 'string';
  return false;
}
