import { boolean, json, number, string } from './default-schemas';
export {
  array,
  boolean,
  color,
  euler,
  json,
  number,
  object,
  optional,
  position3D,
  rotation3D,
  scale3D,
  schema,
  string,
  vec2,
  vec3,
} from './default-schemas';
import type { ReactNode } from 'react';
import type { FieldSegment, FolderSegment, SlotPath } from 'immersive-web-editor';
import { isEditorComponentRef, isJsonValue, type EditorComponentRef, type JsonValue, type SerializedFieldDescriptor } from './rpc';

export type { EditorComponentRef, JsonValue };

export type Vector2 = [number, number];
export type Vector3 = [number, number, number];

export interface EditorFieldComponentProps {
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
}

export type EditorFieldComponent = (props: EditorFieldComponentProps) => ReactNode;

export interface FieldDescriptor {
  component: EditorFieldComponent | EditorComponentRef;
  props?: unknown;
  defaultValue?: JsonValue;
  description?: string;
  label?: string;
  layout?: 'inline' | 'block';
}

export interface Field<T extends JsonValue = JsonValue> {
  readonly __editorField: true;
  readonly label?: string;
  readonly description?: string;
  readonly layout?: 'inline' | 'block';
  readonly descriptor: FieldDescriptor;
  defaultValue(): T;
}

export type FieldTemplate = Field<JsonValue> | { readonly [key: string]: FieldTemplate };

export type FieldValue<T> =
  T extends Field<infer U> ? U
    : T extends { readonly [key: string]: FieldTemplate } ? { [K in keyof T]: FieldValue<T[K]> }
      : never;

export interface FieldOptions<T extends JsonValue = JsonValue> {
  label?: string;
  description?: string;
  default?: T;
  layout?: Field['layout'];
}

export interface DefineFieldOptions<T extends JsonValue> extends FieldOptions<T> {
  defaultValue: T | (() => T);
  component: EditorFieldComponent;
  props?: unknown;
}

interface ConfigMeta {
  id: string;
  panel: string;
  path: string[];
}

type ConfigInput<T> =
  T extends readonly [infer A, infer B, infer C] ? readonly [ConfigInput<A>, ConfigInput<B>, ConfigInput<C>]
    : T extends readonly [infer A, infer B] ? readonly [ConfigInput<A>, ConfigInput<B>]
      : T extends readonly unknown[] ? ConfigInput<T[number]>[]
        : T extends object ? { [K in keyof T]: ConfigInput<T[K]> }
          : T;

export function defineField<T extends JsonValue>(options: DefineFieldOptions<T>): Field<T> {
  const getDefault = () => cloneJson(typeof options.defaultValue === 'function'
    ? (options.defaultValue as () => T)()
    : options.defaultValue);
  const props = toJsonValue(options.props);

  return {
    __editorField: true,
    label: options.label,
    description: options.description,
    layout: options.layout ?? 'inline',
    descriptor: {
      component: options.component,
      ...(props === undefined ? {} : { props }),
      defaultValue: getDefault(),
      description: options.description,
      label: options.label,
      layout: options.layout ?? 'inline',
    },
    defaultValue: getDefault,
  };
}

function isField(value: unknown): value is Field {
  return Boolean(value && typeof value === 'object' && (value as Field).__editorField === true);
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item) ?? null);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, toJsonValue(item)] as const)
      .filter((entry): entry is readonly [string, JsonValue] => entry[1] !== undefined);
    return Object.fromEntries(entries);
  }
  return undefined;
}

function unwrap<T>(input: T): ConfigInput<T> {
  if (input && typeof input === 'object') {
    if (Array.isArray(input)) return input.map((value) => unwrap(value)) as ConfigInput<T>;
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, unwrap(value)]),
    ) as ConfigInput<T>;
  }
  return input as ConfigInput<T>;
}

function inferredField(value: JsonValue): Field {
  if (typeof value === 'string') return string(value);
  if (typeof value === 'number') return number(value);
  if (typeof value === 'boolean') return boolean(value);
  return json(value);
}

function isConfigMeta(value: unknown): value is ConfigMeta {
  return Boolean(
    value
      && typeof value === 'object'
      && typeof (value as ConfigMeta).id === 'string'
      && typeof (value as ConfigMeta).panel === 'string'
      && Array.isArray((value as ConfigMeta).path),
  );
}

function sendToEditor(message: unknown): void {
  try {
    if (window.parent === window) return;
    window.parent.postMessage(message, window.location.origin);
  } catch {
    // Outside a browser or cross-origin parent: silently no-op.
  }
}

function registerValue<T extends JsonValue>(meta: ConfigMeta, value: T, field: Field<T>): void {
  const component = field.descriptor.component;
  if (!isEditorComponentRef(component)) {
    console.warn(
      `[editor] "${meta.panel}.${meta.path.join('.')}" has an inline field component that was not extracted. Add "use editor" as the first statement in the component body.`,
    );
    return;
  }
  if ('props' in field.descriptor && !isJsonValue(field.descriptor.props)) {
    console.warn(`[editor] "${meta.panel}.${meta.path.join('.')}" field props must be JSON-serializable.`);
    return;
  }

  const registration = {
    ...meta,
    value,
    field: field.descriptor as SerializedFieldDescriptor,
  };
  sendToEditor({ type: 'editor:addField', field: registration });
}

export function val<T extends string | number | boolean>(value: T): T;
export function val<T extends JsonValue>(value: T): T;
export function val<F extends Field<JsonValue>>(value: FieldValue<F>, field: F): FieldValue<F>;
export function val<T extends JsonValue>(meta: ConfigMeta, value: T): T;
export function val<F extends Field<JsonValue>>(meta: ConfigMeta, value: FieldValue<F>, field: F): FieldValue<F>;
export function val(
  metaOrValue: ConfigMeta | JsonValue,
  valueOrField?: JsonValue | Field,
  maybeField?: Field,
): JsonValue {
  if (isConfigMeta(metaOrValue)) {
    const value = valueOrField as JsonValue;
    registerValue(metaOrValue, value, isField(maybeField) ? maybeField : inferredField(value));
    return value;
  }
  return metaOrValue;
}

export function config<T>(label: string, shape: T): ConfigInput<T>;
export function config<T>(id: string, label: string, shape: T): ConfigInput<T>;
export function config<T>(idOrLabel: string, labelOrShape: string | T, maybeShape?: T): ConfigInput<T> {
  const shape = arguments.length === 2 ? labelOrShape : maybeShape;
  return unwrap(shape as T);
}

export const configurable = config;
