import {
  defineField,
  type EditorComponentRef,
  type Field,
  type FieldOptions,
  type FieldTemplate,
  type FieldValue,
  type JsonValue,
  type Vector2,
  type Vector3,
} from './configurable';
import { DEFAULT_SCHEMA_COMPONENT_MODULE } from './rpc';

export interface StringFieldOptions extends FieldOptions<string> {
  multiline?: boolean;
  placeholder?: string;
}

export interface NumberFieldOptions extends FieldOptions<number> {
  min?: number;
  max?: number;
  step?: number;
}

export interface BooleanFieldOptions extends FieldOptions<boolean> { }

export interface ColorFieldOptions extends FieldOptions<string> {
  alpha?: boolean;
}

export interface FileUrlFieldOptions extends FieldOptions<string> {
  accept?: string;
}

export interface VectorFieldOptions<T extends Vector2 | Vector3> extends FieldOptions<T> {
  min?: number;
  max?: number;
  step?: number;
}

export type Transform3D = {
  [key: string]: JsonValue;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
};

export interface Transform3DFieldOptions extends FieldOptions<Transform3D> { }

export interface ObjectFieldOptions<T extends { readonly [key: string]: FieldTemplate }> extends FieldOptions<FieldValue<T>> {
  shape: T;
}

export interface ArrayFieldOptions<T extends FieldTemplate = FieldTemplate> extends FieldOptions<FieldValue<T>[]> {
  item: T;
  itemLabel?: string;
  min?: number;
  max?: number;
}

export interface OptionalFieldOptions<T extends FieldTemplate> extends FieldOptions<FieldValue<T> | null> {
  item: T;
}

const DEFAULT_TRANSFORM_3D: Transform3D = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };

function component(exportName: string): EditorComponentRef {
  return { module: DEFAULT_SCHEMA_COMPONENT_MODULE, exportName };
}

function isField(value: unknown): value is Field {
  return Boolean(value && typeof value === 'object' && (value as Field).__editorField === true);
}

function fieldFromTemplate<T extends FieldTemplate>(template: T): Field<FieldValue<T>> {
  if (isField(template)) return template as Field<FieldValue<T>>;
  return object({ shape: template }) as Field<FieldValue<T>>;
}

export function string(options: StringFieldOptions = {}): Field<string> {
  return defineField({
    ...options,
    defaultValue: options.default ?? '',
    component: component('StringFieldComponent'),
    props: {
      multiline: options.multiline,
      placeholder: options.placeholder,
    },
  });
}

export function number(options: NumberFieldOptions = {}): Field<number> {
  return defineField({
    ...options,
    defaultValue: options.default ?? 0,
    component: component('NumberFieldComponent'),
    props: {
      min: options.min,
      max: options.max,
      step: options.step,
    },
  });
}

export function boolean(options: BooleanFieldOptions = {}): Field<boolean> {
  return defineField({
    ...options,
    defaultValue: options.default ?? false,
    component: component('BooleanFieldComponent'),
    props: {},
  });
}

export function color(options: ColorFieldOptions = {}): Field<string> {
  return defineField({
    ...options,
    defaultValue: options.default ?? '#ffffff',
    component: component('ColorFieldComponent'),
    props: { alpha: options.alpha },
  });
}

export function fileUrl(options: FileUrlFieldOptions = {}): Field<string> {
  return defineField({
    ...options,
    defaultValue: options.default ?? '',
    component: component('FileUrlFieldComponent'),
    props: {
      accept: options.accept,
    },
  });
}

export function vec2(options: VectorFieldOptions<Vector2> = {}): Field<Vector2> {
  return defineField({
    ...options,
    defaultValue: options.default ?? [0, 0],
    component: component('Vector2FieldComponent'),
    props: {
      size: 2,
      min: options.min,
      max: options.max,
      step: options.step,
    },
  }) as Field<Vector2>;
}

export function vec3(options: VectorFieldOptions<Vector3> = {}): Field<Vector3> {
  return defineField({
    ...options,
    defaultValue: options.default ?? [0, 0, 0],
    component: component('Vector3FieldComponent'),
    props: {
      size: 3,
      min: options.min,
      max: options.max,
      step: options.step,
    },
  }) as Field<Vector3>;
}

export function position3D(options: VectorFieldOptions<Vector3> = {}): Field<Vector3> {
  return vector3WithHandle(options, 'translate', [0, 0, 0]);
}

export function euler(options: VectorFieldOptions<Vector3> = {}): Field<Vector3> {
  return vec3(options);
}

function vector3WithHandle(
  options: VectorFieldOptions<Vector3>,
  handle: 'translate' | 'rotate' | 'scale',
  defaultValue: Vector3,
): Field<Vector3> {
  return defineField({
    ...options,
    defaultValue: options.default ?? defaultValue,
    component: component('Vector3WithHandleFieldComponent'),
    props: {
      size: 3,
      min: options.min,
      max: options.max,
      step: options.step,
      handle,
    },
  }) as Field<Vector3>;
}

export function transform3D(
  options: Transform3DFieldOptions = {},
): Field<Transform3D> {
  return defineField<Transform3D>({
    ...options,
    layout: options.layout ?? 'block',
    defaultValue: options.default ?? DEFAULT_TRANSFORM_3D,
    component: component('Transform3DFieldComponent'),
    props: {},
  });
}

export function object<T extends { readonly [key: string]: FieldTemplate }>(
  options: ObjectFieldOptions<T>,
): Field<FieldValue<T>> {
  const { shape } = options;
  const fields = Object.fromEntries(
    Object.entries(shape).map(([key, value]) => [key, fieldFromTemplate(value)]),
  ) as { [K in keyof FieldValue<T>]: Field<FieldValue<T>[K]> };

  return defineField({
    ...options,
    layout: options.layout ?? 'block',
    defaultValue: () => Object.fromEntries(
      Object.entries(fields).map(([key, field]) => [key, (field as Field).defaultValue()]),
    ) as FieldValue<T>,
    component: component('ObjectFieldComponent'),
    props: {
      shape: Object.fromEntries(
        Object.entries(fields).map(([key, field]) => [key, (field as Field).descriptor]),
      ),
    },
  });
}

export function array<T extends FieldTemplate>(options: ArrayFieldOptions<T>): Field<FieldValue<T>[]> {
  const { item } = options;
  const itemField = fieldFromTemplate(item);
  return defineField<FieldValue<T>[]>({
    ...options,
    layout: options.layout ?? 'block',
    defaultValue: () => [],
    component: component('ArrayFieldComponent'),
    props: {
      item: itemField.descriptor,
      itemLabel: options.itemLabel,
      min: options.min,
      max: options.max,
    },
  });
}

export function optional<T extends FieldTemplate>(
  options: OptionalFieldOptions<T>,
): Field<FieldValue<T> | null> {
  const { item } = options;
  const itemField = fieldFromTemplate(item);
  return defineField({
    ...options,
    layout: options.layout ?? 'block',
    defaultValue: () => null,
    component: component('OptionalFieldComponent'),
    props: { item: itemField.descriptor },
  });
}

export function json(options: FieldOptions<JsonValue> = {}): Field<JsonValue> {
  return defineField({
    ...options,
    layout: options.layout ?? 'block',
    defaultValue: options.default ?? null,
    component: component('JsonFieldComponent'),
    props: {},
  });
}

export const schema = {
  string,
  number,
  boolean,
  color,
  fileUrl,
  vec2,
  vec3,
  position3D,
  euler,
  transform3D,
  object,
  array,
  optional,
  json,
};
