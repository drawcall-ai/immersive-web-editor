import {
  BooleanField,
  ColorField,
  NumberField,
  Slot,
  StringField,
  Vector3Field,
  type FolderSegment,
} from '@iwe/ui';
import { Plus, ToggleLeft, X } from 'lucide-react';
import {
  defineField,
  type Field,
  type FieldDescriptor,
  type FieldOptions,
  type FieldTemplate,
  type FieldValue,
  type JsonValue,
  type Vector2,
  type Vector3,
} from './configurable';
import { styles } from './client/styles';
import { cx } from '@emotion/css';

export interface StringFieldOptions extends FieldOptions<string> {
  multiline?: boolean;
  placeholder?: string;
}

export interface NumberFieldOptions extends FieldOptions<number> {
  min?: number;
  max?: number;
  step?: number;
}

export interface BooleanFieldOptions extends FieldOptions<boolean> {}

export interface ColorFieldOptions extends FieldOptions<string> {
  alpha?: boolean;
}

export interface VectorFieldOptions<T extends Vector2 | Vector3> extends FieldOptions<T> {
  min?: number;
  max?: number;
  step?: number;
}

export interface ArrayFieldOptions<T extends JsonValue = JsonValue> extends FieldOptions<T[]> {
  itemLabel?: string;
  min?: number;
  max?: number;
}

function isField(value: unknown): value is Field {
  return Boolean(value && typeof value === 'object' && (value as Field).__editorField === true);
}

function fieldFromTemplate<T extends FieldTemplate>(template: T): Field<FieldValue<T>> {
  if (isField(template)) return template as Field<FieldValue<T>>;
  return object(template) as Field<FieldValue<T>>;
}

function objectValue(value: JsonValue): Record<string, JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : {};
}

function arrayValue(value: JsonValue): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function propsObject(props: unknown): Record<string, unknown> {
  return props && typeof props === 'object' && !Array.isArray(props) ? props as Record<string, unknown> : {};
}

function propNumber(props: unknown, key: string): number | undefined {
  const value = propsObject(props)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function propString(props: unknown, key: string): string | undefined {
  const value = propsObject(props)[key];
  return typeof value === 'string' ? value : undefined;
}

function propDescriptor(props: unknown, key: string): FieldDescriptor | undefined {
  const value = propsObject(props)[key];
  return value && typeof value === 'object' && !Array.isArray(value) && typeof (value as FieldDescriptor).component === 'function'
    ? value as FieldDescriptor
    : undefined;
}

function shapeDescriptors(props: unknown): Record<string, FieldDescriptor> {
  const shape = propsObject(props).shape;
  if (!shape || typeof shape !== 'object' || Array.isArray(shape)) return {};
  return Object.fromEntries(
    Object.entries(shape).filter(([, value]) => (
      value && typeof value === 'object' && !Array.isArray(value) && typeof (value as FieldDescriptor).component === 'function'
    )),
  ) as Record<string, FieldDescriptor>;
}

function pathTitle(part: string | number | FolderSegment | undefined): string {
  if (part === undefined) return 'Value';
  return typeof part === 'object' ? part.title : String(part);
}

function vectorInput(value: JsonValue, index: number): number {
  return Array.isArray(value) && typeof value[index] === 'number' ? value[index] : 0;
}

export function string(defaultValue = '', options?: StringFieldOptions): Field<string> {
  return defineField({
    ...options,
    defaultValue: options?.default ?? defaultValue,
    component: ({ field, path, setValue, value }) => {
      "use editor";
      return (
        <StringField
          path={path}
          value={typeof value === 'string' ? value : ''}
          placeholder={propString(field.props, 'placeholder')}
          onCommit={(next) => setValue(next)}
        />
      );
    },
    props: {
      multiline: options?.multiline,
      placeholder: options?.placeholder,
    },
  });
}

export function number(defaultValue = 0, options?: NumberFieldOptions): Field<number> {
  return defineField({
    ...options,
    defaultValue: options?.default ?? defaultValue,
    component: ({ field, path, setValue, value }) => {
      "use editor";
      return (
        <NumberField
          path={path}
          value={typeof value === 'number' && Number.isFinite(value) ? value : 0}
          min={propNumber(field.props, 'min')}
          max={propNumber(field.props, 'max')}
          step={propNumber(field.props, 'step')}
          onCommit={(next) => setValue(next)}
        />
      );
    },
    props: {
      min: options?.min,
      max: options?.max,
      step: options?.step,
    },
  });
}

export function boolean(defaultValue = false, options?: BooleanFieldOptions): Field<boolean> {
  return defineField({
    ...options,
    defaultValue: options?.default ?? defaultValue,
    component: ({ path, setValue, value }) => {
      "use editor";
      return <BooleanField path={path} value={typeof value === 'boolean' ? value : false} onCommit={(next) => setValue(next)} />;
    },
    props: {},
  });
}

export function color(defaultValue = '#ffffff', options?: ColorFieldOptions): Field<string> {
  return defineField({
    ...options,
    defaultValue: options?.default ?? defaultValue,
    component: ({ path, setValue, value }) => {
      "use editor";
      return <ColorField path={path} value={typeof value === 'string' ? value : '#ffffff'} onCommit={(next) => setValue(next)} />;
    },
    props: { alpha: options?.alpha },
  });
}

export function vec2(defaultValue: Vector2 = [0, 0], options?: VectorFieldOptions<Vector2>): Field<Vector2> {
  return defineField({
    ...options,
    defaultValue: options?.default ?? defaultValue,
    component: ({ field, path, setValue, value }) => {
      "use editor";
      const vector = Array.isArray(value) ? value : [];
      return (
        <Slot path={path}>
          <div className={cx(styles.configVector, styles.configVector2)}>
            {[0, 1].map((index) => (
              <input
                aria-label={['x', 'y'][index]}
                className={styles.configInput}
                key={index}
                max={propNumber(field.props, 'max')}
                min={propNumber(field.props, 'min')}
                step={propNumber(field.props, 'step') ?? 1}
                type="number"
                value={String(vectorInput(value, index))}
                onChange={(event) => {
                  const next: Vector2 = [vectorInput(vector, 0), vectorInput(vector, 1)];
                  next[index] = Number(event.currentTarget.value);
                  setValue(next);
                }}
              />
            ))}
          </div>
        </Slot>
      );
    },
    props: {
      size: 2,
      min: options?.min,
      max: options?.max,
      step: options?.step,
    },
  }) as Field<Vector2>;
}

export function vec3(defaultValue: Vector3 = [0, 0, 0], options?: VectorFieldOptions<Vector3>): Field<Vector3> {
  return defineField({
    ...options,
    defaultValue: options?.default ?? defaultValue,
    component: ({ path, setValue, value }) => {
      "use editor";
      return (
        <Vector3Field
          path={path}
          value={[vectorInput(value, 0), vectorInput(value, 1), vectorInput(value, 2)]}
          onCommit={(next) => setValue(next)}
        />
      );
    },
    props: {
      size: 3,
      min: options?.min,
      max: options?.max,
      step: options?.step,
    },
  }) as Field<Vector3>;
}

export function position3D(defaultValue: Vector3 = [0, 0, 0], options?: VectorFieldOptions<Vector3>): Field<Vector3> {
  return vec3(defaultValue, { ...options, label: options?.label });
}

export function euler(defaultValue: Vector3 = [0, 0, 0], options?: VectorFieldOptions<Vector3>): Field<Vector3> {
  return vec3(defaultValue, { ...options, label: options?.label });
}

export function rotation3D(defaultValue: Vector3 = [0, 0, 0], options?: VectorFieldOptions<Vector3>): Field<Vector3> {
  return vec3(defaultValue, { ...options, label: options?.label });
}

export function scale3D(defaultValue: Vector3 = [1, 1, 1], options?: VectorFieldOptions<Vector3>): Field<Vector3> {
  return vec3(defaultValue, { ...options, label: options?.label });
}

export function object<T extends { readonly [key: string]: FieldTemplate }>(
  shape: T,
  options?: FieldOptions<FieldValue<T>>,
): Field<FieldValue<T>> {
  const fields = Object.fromEntries(
    Object.entries(shape).map(([key, value]) => [key, fieldFromTemplate(value)]),
  ) as { [K in keyof FieldValue<T>]: Field<FieldValue<T>[K]> };

  return defineField({
    ...options,
    layout: options?.layout ?? 'block',
    defaultValue: () => Object.fromEntries(
      Object.entries(fields).map(([key, field]) => [key, (field as Field).defaultValue()]),
    ) as FieldValue<T>,
    component: ({ dataPath, defaultValue, field, renderField, setValue, value, viewPath }) => {
      "use editor";
      const current = objectValue(value);
      return (
        <>
          {Object.entries(shapeDescriptors(field.props)).map(([key, child]) => renderField({
            dataPath: [...dataPath, key],
            field: child,
            key,
            value: current[key] ?? defaultValue(child),
            viewPath: [...viewPath, key],
            setValue: (nextValue) => setValue({ ...current, [key]: nextValue }),
          }))}
        </>
      );
    },
    props: {
      shape: Object.fromEntries(
        Object.entries(fields).map(([key, field]) => [key, (field as Field).descriptor]),
      ),
    },
  });
}

export function array<T extends FieldTemplate>(item: T, options?: ArrayFieldOptions<FieldValue<T>>): Field<FieldValue<T>[]> {
  const itemField = fieldFromTemplate(item);
  return defineField<FieldValue<T>[]>({
    ...options,
    layout: options?.layout ?? 'block',
    defaultValue: () => [],
    component: ({
      configFolder,
      dataPath,
      defaultValue,
      field,
      fieldSegment,
      folder,
      label,
      panelFolder,
      renderField,
      setValue,
      slotPath,
      value,
      viewPath,
    }) => {
      "use editor";
      const current = arrayValue(value);
      const itemDescriptor = propDescriptor(field.props, 'item') ?? json(null).descriptor;
      const itemLabelValue = propString(field.props, 'itemLabel');
      const max = propNumber(field.props, 'max');
      const min = propNumber(field.props, 'min') ?? 0;
      const canAdd = max === undefined || current.length < max;
      const canRemove = min < current.length;
      const arrayFolder = folder(label, `array:${dataPath.join('.')}`, [{
        id: 'add',
        label: `Add ${itemLabelValue ?? 'item'}`,
        icon: Plus,
        disabled: !canAdd,
        run: () => {
          if (!canAdd) return;
          setValue([...current, defaultValue(itemDescriptor)]);
        },
      }], 'accordion', { defaultCollapsed: false });

      return (
        <>
          {current.length === 0 && (
            <Slot path={slotPath([configFolder, panelFolder, ...viewPath.slice(0, -1), arrayFolder], fieldSegment('', `empty:${dataPath.join('.')}`, { hidden: true }))}>
              {null}
            </Slot>
          )}
          {current.map((itemValue, index) => {
            const itemLabel = `${itemLabelValue ?? 'Item'} ${index + 1}`;
            const itemFolder = folder(itemLabel, `item:${dataPath.join('.')}:${index}`, [{
              id: 'remove',
              label: `Remove ${itemLabel}`,
              icon: X,
              disabled: !canRemove,
              run: () => {
                if (!canRemove) return;
                const next = current.slice();
                next.splice(index, 1);
                setValue(next);
              },
            }]);

            return renderField({
              dataPath: [...dataPath, index],
              field: itemDescriptor,
              key: index,
              value: itemValue,
              viewPath: [...viewPath.slice(0, -1), arrayFolder, itemFolder],
              setValue: (nextValue) => {
                const next = current.slice();
                next[index] = nextValue;
                setValue(next);
              },
            });
          })}
        </>
      );
    },
    props: {
      item: itemField.descriptor,
      itemLabel: options?.itemLabel,
      min: options?.min,
      max: options?.max,
    },
  });
}

export function optional<T extends FieldTemplate>(
  item: T,
  options?: FieldOptions<FieldValue<T> | null>,
): Field<FieldValue<T> | null> {
  const itemField = fieldFromTemplate(item);
  return defineField({
    ...options,
    layout: options?.layout ?? 'block',
    defaultValue: () => null,
    component: ({
      configFolder,
      dataPath,
      defaultValue,
      field,
      fieldSegment,
      panelFolder,
      path,
      renderField,
      setValue,
      slotPath,
      value,
      viewPath,
    }) => {
      "use editor";
      const item = propDescriptor(field.props, 'item') ?? json(null).descriptor;
      if (value === null) {
        return (
          <Slot path={path}>
            <button className={styles.configButton} type="button" onClick={() => setValue(defaultValue(item))}>
              Set value
            </button>
          </Slot>
        );
      }

      return (
        <>
          {renderField({
            dataPath,
            field: item,
            value,
            viewPath,
            setValue,
          })}
          <Slot path={slotPath([configFolder, panelFolder, ...viewPath.slice(0, -1)], fieldSegment(`${pathTitle(viewPath.at(-1))} state`, `optional:${dataPath.join('.')}`, { icon: <ToggleLeft aria-hidden /> }))}>
            <button className={styles.configButton} type="button" onClick={() => setValue(null)}>
              Clear
            </button>
          </Slot>
        </>
      );
    },
    props: { item: itemField.descriptor },
  });
}

export function json(defaultValue: JsonValue = null, options?: FieldOptions<JsonValue>): Field<JsonValue> {
  return defineField({
    ...options,
    layout: options?.layout ?? 'block',
    defaultValue,
    component: ({ path, setValue, value }) => {
      "use editor";
      return (
        <Slot path={path}>
          <textarea
            className={styles.configTextarea}
            value={JSON.stringify(value, null, 2)}
            onChange={(event) => {
              try {
                setValue(JSON.parse(event.currentTarget.value) as JsonValue);
              } catch {
                // Keep the draft visible until it becomes valid JSON.
              }
            }}
          />
        </Slot>
      );
    },
    props: {},
  });
}

export const schema = {
  string,
  number,
  boolean,
  color,
  vec2,
  vec3,
  position3D,
  euler,
  rotation3D,
  scale3D,
  object,
  array,
  optional,
  json,
};
