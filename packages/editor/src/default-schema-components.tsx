import { cx } from '@emotion/css';
import type { FolderSegment } from '@immersive-web-editor/ui';
import { PivotHandlesContext, PivotHandlesHandles, TransformHandles, defaultApply } from '@react-three/handle';
import { Plus, ToggleLeft, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { OverlayCanvasPortal } from './ui/overlay-canvas';
import { styles } from './ui/styles';
import type { EditorApiClient } from './ui/editor-api-client';
import type { PublicFile } from './rpc';
import type { Transform3D } from './default-schemas';
import type {
  EditorFieldComponent,
  FieldDescriptor,
  JsonValue,
} from './ui/sdk';
import type {
  Vector2,
  Vector3,
} from './authoring-core';

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
  return value && typeof value === 'object' && !Array.isArray(value) ? value as FieldDescriptor : undefined;
}

function shapeDescriptors(props: unknown): Record<string, FieldDescriptor> {
  const shape = propsObject(props).shape;
  if (!shape || typeof shape !== 'object' || Array.isArray(shape)) return {};
  return Object.fromEntries(
    Object.entries(shape).filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value)),
  ) as Record<string, FieldDescriptor>;
}

function pathTitle(part: string | number | FolderSegment | undefined): string {
  if (part === undefined) return 'Value';
  return typeof part === 'object' ? part.title : String(part);
}

function vectorInput(value: JsonValue, index: number): number {
  return Array.isArray(value) && typeof value[index] === 'number' ? value[index] : 0;
}

function vector3Value(value: JsonValue, fallback: Vector3 = [0, 0, 0]): Vector3 {
  return [
    Array.isArray(value) && typeof value[0] === 'number' && Number.isFinite(value[0]) ? value[0] : fallback[0],
    Array.isArray(value) && typeof value[1] === 'number' && Number.isFinite(value[1]) ? value[1] : fallback[1],
    Array.isArray(value) && typeof value[2] === 'number' && Number.isFinite(value[2]) ? value[2] : fallback[2],
  ];
}

function roundedVector3(value: readonly number[]): Vector3 {
  return [
    Math.round(value[0] * 100) / 100,
    Math.round(value[1] * 100) / 100,
    Math.round(value[2] * 100) / 100,
  ];
}

function transform3DValue(value: JsonValue, fallback: Transform3D): Transform3D {
  const current = objectValue(value);
  return {
    position: vector3Value(current.position, fallback.position),
    rotation: vector3Value(current.rotation, fallback.rotation),
    scale: vector3Value(current.scale, fallback.scale),
  };
}

function CommittedNumberInput({
  ariaLabel,
  max,
  min,
  onCommit,
  step,
  value,
}: {
  ariaLabel: string;
  max?: number;
  min?: number;
  onCommit(value: number): void;
  step: number;
  value: number;
}) {
  const source = String(value);
  const [draft, setDraft] = useState(source);
  useEffect(() => setDraft(source), [source]);

  const commit = (nextDraft: string) => {
    const next = Number(nextDraft);
    if (nextDraft !== source && Number.isFinite(next)) onCommit(next);
  };

  return (
    <input
      aria-label={ariaLabel}
      className={styles.fieldInput}
      max={max}
      min={min}
      step={step}
      type="number"
      value={draft}
      onBlur={(event) => commit(event.currentTarget.value)}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit(event.currentTarget.value);
          event.currentTarget.blur();
        }
        if (event.key === 'Escape') {
          setDraft(source);
          event.currentTarget.blur();
        }
      }}
      onPointerUp={(event) => commit(event.currentTarget.value)}
    />
  );
}

function CommittedStringInput({
  multiline,
  onCommit,
  placeholder,
  value,
}: {
  multiline?: boolean;
  onCommit(value: string): void;
  placeholder?: string;
  value: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = (next = draft) => {
    if (next !== value) onCommit(next);
  };

  const sharedProps = {
    placeholder,
    value: draft,
    onBlur: () => commit(),
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.currentTarget.value),
    onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !multiline) {
        commit(event.currentTarget.value);
        event.currentTarget.blur();
      }
      if (event.key === 'Escape') {
        setDraft(value);
        event.currentTarget.blur();
      }
    },
  };

  return multiline
    ? <textarea className={styles.fieldTextarea} {...sharedProps} />
    : <input className={styles.fieldInput} {...sharedProps} />;
}

function VectorInput({
  field,
  setValue,
  size,
  value,
}: {
  field: FieldDescriptor;
  setValue(value: JsonValue): void | Promise<void>;
  size: 2 | 3;
  value: JsonValue;
}) {
  const vector = Array.isArray(value) ? value : [];
  return (
    <div className={cx(styles.fieldVector, size === 2 && styles.fieldVector2)}>
      {Array.from({ length: size }, (_, index) => (
        <CommittedNumberInput
          ariaLabel={['x', 'y', 'z'][index] ?? String(index)}
          key={index}
          max={propNumber(field.props, 'max')}
          min={propNumber(field.props, 'min')}
          value={vectorInput(value, index)}
          step={propNumber(field.props, 'step') ?? 1}
          onCommit={(nextValue) => {
            const next = Array.from({ length: size }, (_, itemIndex) => vectorInput(vector, itemIndex)) as Vector2 | Vector3;
            next[index] = nextValue;
            setValue(next);
          }}
        />
      ))}
    </div>
  );
}

export const StringFieldComponent: EditorFieldComponent = ({ field, setValue, value }) => (
  <CommittedStringInput
    multiline={propsObject(field.props).multiline === true}
    value={typeof value === 'string' ? value : ''}
    placeholder={propString(field.props, 'placeholder')}
    onCommit={(next) => void setValue(next)}
  />
);

export const NumberFieldComponent: EditorFieldComponent = ({ field, setValue, value }) => (
  <CommittedNumberInput
    ariaLabel={field.label ?? 'Number'}
    value={typeof value === 'number' && Number.isFinite(value) ? value : 0}
    min={propNumber(field.props, 'min')}
    max={propNumber(field.props, 'max')}
    step={propNumber(field.props, 'step') ?? 1}
    onCommit={(next) => void setValue(next)}
  />
);

export const BooleanFieldComponent: EditorFieldComponent = ({ setValue, value }) => (
  <label className={styles.fieldToggle}>
    <input type="checkbox" checked={typeof value === 'boolean' ? value : false} onChange={(event) => setValue(event.currentTarget.checked)} />
    <span>{value ? 'On' : 'Off'}</span>
  </label>
);

export const ColorFieldComponent: EditorFieldComponent = ({ setValue, value }) => {
  const committedValue = typeof value === 'string' ? value : '#ffffff';
  const [draftValue, setDraftValue] = useState(committedValue);

  useEffect(() => {
    setDraftValue(committedValue);
  }, [committedValue]);

  return (
    <input
      className={cx(styles.fieldInput, styles.fieldColor)}
      type="color"
      value={draftValue}
      onChange={(event) => setDraftValue(event.currentTarget.value)}
      onBlur={(event) => setValue(event.currentTarget.value)}
    />
  );
};

function matchesAccept(fileName: string, accept: string | undefined): boolean {
  if (!accept) return true;
  const rules = accept.split(',').map((rule) => rule.trim().toLowerCase()).filter(Boolean);
  if (rules.length === 0) return true;
  const lowerFileName = fileName.toLowerCase();
  const extension = lowerFileName.includes('.') ? lowerFileName.slice(lowerFileName.lastIndexOf('.')) : '';
  const mimeExtensions: Record<string, readonly string[]> = {
    'image/apng': ['.apng'],
    'image/avif': ['.avif'],
    'image/gif': ['.gif'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/svg+xml': ['.svg'],
    'image/webp': ['.webp'],
    'audio/mpeg': ['.mp3'],
    'audio/ogg': ['.oga', '.ogg'],
    'audio/wav': ['.wav'],
    'video/mp4': ['.mp4', '.m4v'],
    'video/ogg': ['.ogv'],
    'video/webm': ['.webm'],
  };
  return rules.some((rule) => {
    if (rule.startsWith('.')) return extension === rule;
    if (rule === 'image/*') return ['.apng', '.avif', '.gif', '.jpg', '.jpeg', '.png', '.svg', '.webp'].includes(extension);
    if (rule === 'audio/*') return ['.aac', '.flac', '.m4a', '.mp3', '.oga', '.ogg', '.wav', '.weba'].includes(extension);
    if (rule === 'video/*') return ['.avi', '.m4v', '.mov', '.mp4', '.mpeg', '.ogv', '.webm'].includes(extension);
    return mimeExtensions[rule]?.includes(extension) ?? true;
  });
}

function FileUrlInput({
  accept,
  editorApi,
  setValue,
  value,
}: {
  accept?: string;
  editorApi: EditorApiClient;
  setValue(value: string): void | Promise<void>;
  value: string;
}) {
  const [files, setFiles] = useState<PublicFile[]>([]);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibleFiles = useMemo(() => files.filter((file) => matchesAccept(file.fileName, accept)), [accept, files]);
  const hasCurrentValue = value !== '' && !visibleFiles.some((file) => file.fileName === value);
  const selectedValue = value || visibleFiles[0]?.fileName || '';

  const refreshFiles = async () => {
    setStatus('loading');
    setError(null);
    try {
      const result = await editorApi.publicFiles.list();
      setFiles(result.files);
      setStatus('success');
      return result.files;
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
      return [];
    }
  };

  useEffect(() => {
    void refreshFiles();
  }, [editorApi]);

  useEffect(() => {
    if (value !== '' || visibleFiles.length === 0) return;
    void setValue(visibleFiles[0]!.fileName);
  }, [visibleFiles, setValue, value]);

  const uploadFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const payload = await editorApi.publicFiles.upload({
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        dataBase64: await fileToBase64(file),
      });
      await refreshFiles().catch(() => undefined);
      await setValue(payload.fileName);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={styles.fieldFileUpload}>
      <div className={styles.fieldFileRow}>
        <select
          className={styles.fieldSelect}
          value={selectedValue}
          onChange={(event) => setValue(event.currentTarget.value)}
        >
          {visibleFiles.length === 0 && (
            <option disabled value="">
              {status === 'loading' ? 'Loading files...' : 'Upload a file'}
            </option>
          )}
          {hasCurrentValue && <option value={value}>{value}</option>}
          {visibleFiles.map((file) => (
            <option key={file.fileName} value={file.fileName}>
              {file.fileName}
            </option>
          ))}
        </select>
        <label className={styles.fieldFileButton} data-disabled={uploading ? 'true' : undefined}>
          <Upload aria-hidden />
          <span>{uploading ? 'Uploading' : 'Upload'}</span>
          <input
            accept={accept}
            className={styles.fieldFileInput}
            disabled={uploading}
            type="file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void uploadFile(file);
            }}
          />
        </label>
      </div>
      {error && <div className={styles.fieldFileError}>{error}</div>}
    </div>
  );
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < buffer.length; index += chunkSize) {
    binary += String.fromCharCode(...buffer.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export const FileUrlFieldComponent: EditorFieldComponent = ({ editorApi, field, setValue, value }) => {
  const current = typeof value === 'string' ? value : '';
  const accept = propString(field.props, 'accept');
  return <FileUrlInput accept={accept} editorApi={editorApi} value={current} setValue={(next) => setValue(next)} />;
};

export const Vector2FieldComponent: EditorFieldComponent = ({ field, setValue, value }) => (
  <VectorInput field={field} size={2} value={value} setValue={setValue} />
);

export const Vector3FieldComponent: EditorFieldComponent = ({ field, setValue, value }) => (
  <VectorInput field={field} size={3} value={value} setValue={setValue} />
);

export const Vector3WithHandleFieldComponent: EditorFieldComponent = ({ field, setValue, value }) => {
  const handle = propString(field.props, 'handle');
  const mode = handle === 'rotate' || handle === 'scale' ? handle : 'translate';
  const fallback = vector3Value(field.defaultValue ?? null, mode === 'scale' ? [1, 1, 1] : [0, 0, 0]);
  const vector = vector3Value(value, fallback);
  const apply = (state: Parameters<typeof defaultApply>[0], target: Parameters<typeof defaultApply>[1]) => {
    defaultApply(state, target);
    if (!state.last) return;
    if (mode === 'translate') void setValue(roundedVector3(target.position.toArray()));
    if (mode === 'rotate') void setValue(roundedVector3([target.rotation.x, target.rotation.y, target.rotation.z]));
    if (mode === 'scale') void setValue(roundedVector3(target.scale.toArray()));
  };

  return (
    <>
      <VectorInput field={field} size={3} value={vector} setValue={setValue} />
      <OverlayCanvasPortal>
        {mode === 'translate' && <TransformHandles fixed mode="translate" position={vector} size={0.75} apply={apply} />}
        {mode === 'rotate' && <TransformHandles fixed mode="rotate" rotation={vector} size={0.75} apply={apply} />}
        {mode === 'scale' && <TransformHandles fixed mode="scale" {...{ scale: vector }} size={0.75} apply={apply} />}
      </OverlayCanvasPortal>
    </>
  );
};

const DEFAULT_TRANSFORM_3D: Transform3D = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };

export const Transform3DFieldComponent: EditorFieldComponent = ({
  fieldsPath,
  dataPath,
  field,
  slotSegment,
  folder,
  label,
  fieldFolder,
  renderSlot,
  setValue,
  slotPath,
  value,
  viewPath,
}) => {
  const fallback = transform3DValue(field.defaultValue ?? null, DEFAULT_TRANSFORM_3D);
  const current = transform3DValue(value, fallback);
  const parent = [
    ...fieldsPath,
    fieldFolder,
    ...viewPath.slice(0, -1),
    folder(label, `transform3d:${dataPath.join('.')}`, undefined, 'accordion', { defaultCollapsed: false }),
  ];
  const commit = (key: keyof Transform3D, next: Vector3) => setValue({ ...current, [key]: next });
  const apply = (state: Parameters<typeof defaultApply>[0], target: Parameters<typeof defaultApply>[1]) => {
    defaultApply(state, target);
    if (!state.last) return;
    void setValue({
      ...current,
      position: roundedVector3(target.position.toArray()),
      rotation: roundedVector3([target.rotation.x, target.rotation.y, target.rotation.z]),
      scale: roundedVector3(target.scale.toArray()),
    });
  };

  return (
    <>
      {renderSlot(
        <VectorInput field={field} size={3} value={current.position} setValue={(next) => commit('position', next as Vector3)} />,
        slotPath(parent, slotSegment('Position', `${dataPath.join('.')}:position`)),
      )}
      {renderSlot(
        <VectorInput field={field} size={3} value={current.rotation} setValue={(next) => commit('rotation', next as Vector3)} />,
        slotPath(parent, slotSegment('Rotation', `${dataPath.join('.')}:rotation`)),
      )}
      {renderSlot(
        <VectorInput field={field} size={3} value={current.scale} setValue={(next) => commit('scale', next as Vector3)} />,
        slotPath(parent, slotSegment('Scale', `${dataPath.join('.')}:scale`)),
      )}
      <OverlayCanvasPortal>
        <PivotHandlesContext
          position={current.position}
          rotation={current.rotation}
          {...{ scale: current.scale }}
          apply={apply}
        >
          <PivotHandlesHandles fixed size={0.75} />
        </PivotHandlesContext>
      </OverlayCanvasPortal>
    </>
  );
};

export const ObjectFieldComponent: EditorFieldComponent = ({ dataPath, defaultValue, field, renderField, setValue, value, viewPath }) => {
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
};

function jsonFieldDescriptor(): FieldDescriptor {
  return {
    component: JsonFieldComponent,
    defaultValue: null,
    layout: 'block',
  };
}

export const ArrayFieldComponent: EditorFieldComponent = ({
  fieldsPath,
  dataPath,
  defaultValue,
  field,
  slotSegment,
  folder,
  label,
  fieldFolder,
  renderField,
  renderSlot,
  setValue,
  slotPath,
  value,
  viewPath,
}) => {
  const current = arrayValue(value);
  const itemDescriptor = propDescriptor(field.props, 'item') ?? jsonFieldDescriptor();
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
        renderSlot(null, slotPath([...fieldsPath, fieldFolder, ...viewPath.slice(0, -1), arrayFolder], slotSegment('', `empty:${dataPath.join('.')}`, { hidden: true })))
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
          viewPath: [...viewPath.slice(0, -1), arrayFolder, itemFolder, itemLabel],
          setValue: (nextValue) => {
            const next = current.slice();
            next[index] = nextValue;
            setValue(next);
          },
        });
      })}
    </>
  );
};

export const OptionalFieldComponent: EditorFieldComponent = ({
  fieldsPath,
  dataPath,
  defaultValue,
  field,
  slotSegment,
  fieldFolder,
  path,
  renderField,
  renderSlot,
  setValue,
  slotPath,
  value,
  viewPath,
}) => {
  const item = propDescriptor(field.props, 'item') ?? jsonFieldDescriptor();
  if (value === null) {
    return renderSlot(
        <button className={styles.fieldButton} type="button" onClick={() => setValue(defaultValue(item))}>
          Set value
        </button>,
        path,
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
      {renderSlot(
        <button className={styles.fieldButton} type="button" onClick={() => setValue(null)}>
          Clear
        </button>,
        slotPath([...fieldsPath, fieldFolder, ...viewPath.slice(0, -1)], slotSegment(`${pathTitle(viewPath.at(-1))} state`, `optional:${dataPath.join('.')}`, { icon: <ToggleLeft aria-hidden /> })),
      )}
    </>
  );
};

export const JsonFieldComponent: EditorFieldComponent = ({ path, renderSlot, setValue, value }) => (
  renderSlot(
    <textarea
      className={styles.fieldTextarea}
      value={JSON.stringify(value, null, 2)}
      onChange={(event) => {
        try {
          setValue(JSON.parse(event.currentTarget.value) as JsonValue);
        } catch {
          // Keep the draft visible until it becomes valid JSON.
        }
      }}
    />,
    path,
  )
);
