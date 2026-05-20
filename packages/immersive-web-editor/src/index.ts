export { default, editorPlugin } from './plugin/index.js';
export type {
  EditorBuildOptions,
  EditorSlotPathSegment,
  EditorFolderPath,
  EditorFolderPathSegment,
  EditorOptions,
  EditorPlugin,
  EditorPluginContext,
  EditorRootPathSegment,
  EditorSlotPath,
  InitialCommand,
} from './plugin/options.js';

export declare const array: typeof import('./authoring-api.js').array;
export declare const boolean: typeof import('./authoring-api.js').boolean;
export declare const color: typeof import('./authoring-api.js').color;
export declare const config: typeof import('./authoring-api.js').config;
export declare const configurable: typeof import('./authoring-api.js').configurable;
export declare const defineField: typeof import('./authoring-api.js').defineField;
export declare const editorComponent: typeof import('./authoring-api.js').editorComponent;
export declare const euler: typeof import('./authoring-api.js').euler;
export declare const fileUrl: typeof import('./authoring-api.js').fileUrl;
export declare const json: typeof import('./authoring-api.js').json;
export declare const number: typeof import('./authoring-api.js').number;
export declare const object: typeof import('./authoring-api.js').object;
export declare const optional: typeof import('./authoring-api.js').optional;
export declare const position3D: typeof import('./authoring-api.js').position3D;
export declare const schema: typeof import('./authoring-api.js').schema;
export declare const string: typeof import('./authoring-api.js').string;
export declare const transform3D: typeof import('./authoring-api.js').transform3D;
export declare const val: typeof import('./authoring-api.js').val;
export declare const vec2: typeof import('./authoring-api.js').vec2;
export declare const vec3: typeof import('./authoring-api.js').vec3;

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
} from './authoring-api.js';
