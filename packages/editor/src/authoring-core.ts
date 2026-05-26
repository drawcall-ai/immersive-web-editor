import { boolean, json, number, string } from './default-schemas';
export {
  array,
  boolean,
  color,
  euler,
  fileUrl,
  json,
  number,
  object,
  optional,
  position3D,
  schema,
  string,
  transform3D,
  vec2,
  vec3,
} from './default-schemas';
import { addFieldMessage, isJsonValue, removeFieldsByModulePathMessage, type JsonValue, type PreviewToEditorMessage, type SerializedFieldDescriptor } from './rpc';

export type { JsonValue };

export type Vector2 = [number, number];
export type Vector3 = [number, number, number];

export interface FieldDescriptor {
  component: string;
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
  component: string;
  props?: unknown;
}

interface AuthoredValueMeta {
  id: string;
  modulePath: string;
  fieldFolder: string;
  path: string[];
}

interface ViteHotContext {
  on(event: 'vite:beforeUpdate', cb: (payload: { updates: Array<{ type: string; path: string; acceptedPath: string }> }) => void): void;
  on(event: 'vite:beforePrune', cb: (payload: { paths: string[] }) => void): void;
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
  if (typeof value === 'string') return string({ default: value });
  if (typeof value === 'number') return number({ default: value });
  if (typeof value === 'boolean') return boolean({ default: value });
  return json({ default: value });
}

function isAuthoredValueMeta(value: unknown): value is AuthoredValueMeta {
  return Boolean(
    value
      && typeof value === 'object'
      && typeof (value as AuthoredValueMeta).id === 'string'
      && typeof (value as AuthoredValueMeta).modulePath === 'string'
      && typeof (value as AuthoredValueMeta).fieldFolder === 'string'
      && Array.isArray((value as AuthoredValueMeta).path),
  );
}

function sendToEditor(message: PreviewToEditorMessage): void {
  try {
    if (window.parent === window) return;
    window.parent.postMessage(message, editorOrigin());
  } catch {
    // Outside a browser or cross-origin parent: silently no-op.
  }
}

function editorOrigin(): string {
  const ancestorOrigin = firstAncestorOrigin();
  if (ancestorOrigin) return ancestorOrigin;
  if (document.referrer) {
    try {
      return new URL(document.referrer).origin;
    } catch {
      return window.location.origin;
    }
  }
  return window.location.origin;
}

function firstAncestorOrigin(): string | undefined {
  const ancestorOrigins = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  return ancestorOrigins?.[0] || ancestorOrigins?.item?.(0) || undefined;
}

function registerValue<T extends JsonValue>(meta: AuthoredValueMeta, value: T, field: Field<T>): void {
  const component = field.descriptor.component;
  if (typeof component !== 'string' || component.length === 0) {
    console.warn(`[editor] "${meta.fieldFolder}.${meta.path.join('.')}" field component must be a component name.`);
    return;
  }
  if ('props' in field.descriptor && !isJsonValue(field.descriptor.props)) {
    console.warn(`[editor] "${meta.fieldFolder}.${meta.path.join('.')}" field props must be JSON-serializable.`);
    return;
  }

  const registration = {
    ...meta,
    value,
    field: field.descriptor as SerializedFieldDescriptor,
  };
  sendToEditor(addFieldMessage(registration));
}

function viteHot(): ViteHotContext | undefined {
  return (import.meta as ImportMeta & { hot?: ViteHotContext }).hot;
}

function changedModulePaths(payload: { updates: Array<{ type: string; path: string; acceptedPath: string }> }): string[] {
  return [...new Set(payload.updates
    .filter((update) => update.type === 'js-update')
    .flatMap((update) => [update.path, update.acceptedPath])
    .filter((path) => path.length > 0))];
}

const hot = viteHot();
if (hot) {
  hot.on('vite:beforeUpdate', (payload) => {
    const modulePaths = changedModulePaths(payload);
    if (modulePaths.length > 0) sendToEditor(removeFieldsByModulePathMessage(modulePaths));
  });
  hot.on('vite:beforePrune', (payload) => {
    if (payload.paths.length > 0) sendToEditor(removeFieldsByModulePathMessage(payload.paths));
  });
}

export function val<T extends string | number | boolean>(value: T): T;
export function val<T extends JsonValue>(value: T): T;
export function val<F extends Field<JsonValue>>(value: FieldValue<F>, field: F): FieldValue<F>;
export function val<T extends JsonValue>(meta: AuthoredValueMeta, value: T): T;
export function val<F extends Field<JsonValue>>(meta: AuthoredValueMeta, value: FieldValue<F>, field: F): FieldValue<F>;
export function val(
  metaOrValue: AuthoredValueMeta | JsonValue,
  valueOrField?: JsonValue | Field,
  maybeField?: Field,
): JsonValue {
  if (isAuthoredValueMeta(metaOrValue)) {
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
