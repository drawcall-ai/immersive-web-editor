export type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface SerializedFieldDescriptor {
  component: string;
  props?: JsonValue;
  defaultValue?: JsonValue;
  description?: string;
  label?: string;
  layout?: 'inline' | 'block';
}

export interface FieldRegistration {
  id: string;
  modulePath: string;
  fieldFolder: string;
  path: string[];
  value: JsonValue;
  field: SerializedFieldDescriptor;
}

export interface AddFieldMessage {
  type: 'editor:addField';
  field: FieldRegistration;
}

export interface RemoveFieldsByModulePathMessage {
  type: 'editor:removeFieldsByModulePath';
  modulePaths: string[];
}

export type PreviewToEditorMessage = AddFieldMessage | RemoveFieldsByModulePathMessage;

export interface PublicFile {
  fileName: string;
  url: string;
  size: number;
  mtimeMs: number;
}

export interface ListPublicFilesResponse {
  files: PublicFile[];
}

export interface UploadPublicFileResponse {
  ok: true;
  fileName: string;
  url: string;
  contentType: string;
}

export interface EditorApiErrorResponse {
  error: string;
}

export type EditorApiResponse<T> = T | EditorApiErrorResponse;

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

export function isSerializedFieldDescriptor(value: unknown): value is SerializedFieldDescriptor {
  if (!isObject(value) || typeof value.component !== 'string') return false;
  if ('props' in value && !isJsonValue(value.props)) return false;
  if ('defaultValue' in value && !isJsonValue(value.defaultValue)) return false;
  return true;
}

export function isFieldRegistration(value: unknown): value is FieldRegistration {
  return isObject(value)
    && typeof value.id === 'string'
    && typeof value.modulePath === 'string'
    && typeof value.fieldFolder === 'string'
    && Array.isArray(value.path)
    && value.path.every((part) => typeof part === 'string')
    && isJsonValue(value.value)
    && isSerializedFieldDescriptor(value.field);
}

export function addFieldMessage(field: FieldRegistration): AddFieldMessage {
  return { type: 'editor:addField', field };
}

export function removeFieldsByModulePathMessage(modulePaths: string[]): RemoveFieldsByModulePathMessage {
  return { type: 'editor:removeFieldsByModulePath', modulePaths };
}

export function isPreviewToEditorMessage(value: unknown): value is PreviewToEditorMessage {
  if (!isObject(value) || typeof value.type !== 'string') return false;
  if (value.type === 'editor:addField') return isFieldRegistration(value.field);
  if (value.type === 'editor:removeFieldsByModulePath') {
    return Array.isArray(value.modulePaths)
      && value.modulePaths.every((modulePath) => typeof modulePath === 'string');
  }
  return false;
}

export function isPublicFile(value: unknown): value is PublicFile {
  return isObject(value)
    && typeof value.fileName === 'string'
    && typeof value.url === 'string'
    && typeof value.size === 'number'
    && Number.isFinite(value.size)
    && typeof value.mtimeMs === 'number'
    && Number.isFinite(value.mtimeMs);
}

export function isListPublicFilesResponse(value: unknown): value is ListPublicFilesResponse {
  return isObject(value)
    && Array.isArray(value.files)
    && value.files.every(isPublicFile);
}

export function isUploadPublicFileResponse(value: unknown): value is UploadPublicFileResponse {
  return isObject(value)
    && value.ok === true
    && typeof value.fileName === 'string'
    && typeof value.url === 'string'
    && typeof value.contentType === 'string';
}

export function editorApiError(message: string): EditorApiErrorResponse {
  return { error: message };
}
