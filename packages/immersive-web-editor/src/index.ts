export { default, editorPlugin } from './plugin/index.js';
export type {
  EditorBuildOptions,
  EditorFieldPathSegment,
  EditorFolderPath,
  EditorFolderPathSegment,
  EditorOptions,
  EditorPlugin,
  EditorPluginContext,
  EditorRootPathSegment,
  EditorSlotPath,
  InitialCommand,
} from './plugin/options.js';

export declare const array: typeof import('./app/index.js').array;
export declare const boolean: typeof import('./app/index.js').boolean;
export declare const color: typeof import('./app/index.js').color;
export declare const config: typeof import('./app/index.js').config;
export declare const configurable: typeof import('./app/index.js').configurable;
export declare const defineField: typeof import('./app/index.js').defineField;
export declare const editorComponent: typeof import('./app/index.js').editorComponent;
export declare const euler: typeof import('./app/index.js').euler;
export declare const fileUrl: typeof import('./app/index.js').fileUrl;
export declare const json: typeof import('./app/index.js').json;
export declare const number: typeof import('./app/index.js').number;
export declare const object: typeof import('./app/index.js').object;
export declare const optional: typeof import('./app/index.js').optional;
export declare const position3D: typeof import('./app/index.js').position3D;
export declare const schema: typeof import('./app/index.js').schema;
export declare const string: typeof import('./app/index.js').string;
export declare const transform3D: typeof import('./app/index.js').transform3D;
export declare const val: typeof import('./app/index.js').val;
export declare const vec2: typeof import('./app/index.js').vec2;
export declare const vec3: typeof import('./app/index.js').vec3;

export type {
  ArrayFieldOptions,
  BooleanFieldOptions,
  ColorFieldOptions,
  DefineFieldOptions,
  EditorComponentRef,
  EditorFieldComponent,
  EditorFieldComponentProps,
  Field,
  FieldDescriptor,
  FieldOptions,
  FieldTemplate,
  FieldValue,
  FileUrlFieldOptions,
  JsonValue,
  NumberFieldOptions,
  ObjectFieldOptions,
  OptionalFieldOptions,
  StringFieldOptions,
  Transform3D,
  Transform3DFieldOptions,
  Vector2,
  Vector3,
  VectorFieldOptions,
} from './app/index.js';
