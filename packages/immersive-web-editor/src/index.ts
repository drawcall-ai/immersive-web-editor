import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { build as buildWithEsbuild, type Plugin as EsbuildPlugin } from 'esbuild';
import type { Plugin, ViteDevServer } from 'vite';
import type { EditorApiErrorResponse, ListPublicFilesResponse, PublicFile, UploadPublicFileResponse } from './rpc';

export interface InitialCommand {
  id: string;
  title: string;
  hint?: string;
  keybinding?: string;
  scope?: string;
}

export interface EditorPluginContext {
  server: ViteDevServer;
}

export interface EditorPlugin {
  name: string;
  client?: string;
  commands?: InitialCommand[];
  configureServer?(ctx: EditorPluginContext): void | Promise<void>;
}

export interface EditorBuildOptions {
  enabled?: boolean;
  previewUrl?: string;
}

export interface EditorOptions {
  plugins?: EditorPlugin[];
  build?: EditorBuildOptions;
}

const EDITOR_PATH = '/editor';
const CONFIGURABLES_PATH = '/__editor/configurables';
const EDITOR_PUBLIC_FILES_PATH: typeof import('./rpc').EDITOR_PUBLIC_FILES_PATH = '/__editor/public-files';
const EDITOR_BUILD_HTML_ID = 'virtual:editor/index.html';
const EDITOR_SHELL_VIRTUAL_ID = 'virtual:editor/shell';
const EDITOR_CONFIG_VIRTUAL_ID = 'virtual:editor/config';
const EDITOR_PLUGIN_VIRTUAL_PREFIX = 'virtual:editor/plugin/';
const EDITOR_STATIC_SHELL_PATH = '/__editor/static/editor-shell.js';
const EDITOR_STATIC_SHARED_PREFIX = '/__editor/static/shared/';
const EDITOR_STATIC_COMPONENT_PATH = '/__editor/static/editor-component.js';
const CONFIGURABLE_MODULE_ID = 'immersive-web-editor';
const EDITOR_COMPONENT_QUERY = 'editor-component';
const DEFAULT_PREVIEW_URL = '/?editor_preview=1';
const REACT_DEDUPE = ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'];
const STATIC_SHARED_IMPORTS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'three',
  '@immersive-web-editor/ui',
  '@pmndrs/handle',
  '@pmndrs/pointer-events',
  '@react-three/fiber',
  '@react-three/handle',
  '@react-three/xr',
] as const;
const STATIC_SHARED_EXTERNALS = [...STATIC_SHARED_IMPORTS];
const STATIC_NAMED_EXPORTS: Partial<Record<(typeof STATIC_SHARED_IMPORTS)[number], string[]>> = {
  'react-dom': [
    '__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE',
    'createPortal',
    'flushSync',
    'preconnect',
    'prefetchDNS',
    'preinit',
    'preinitModule',
    'preload',
    'preloadModule',
    'requestFormReset',
    'unstable_batchedUpdates',
    'useFormState',
    'useFormStatus',
    'version',
  ],
  '@react-three/fiber': [
    'Canvas',
    'ReactThreeFiber',
    '_roots',
    'act',
    'addAfterEffect',
    'addEffect',
    'addTail',
    'advance',
    'applyProps',
    'buildGraph',
    'context',
    'createEvents',
    'createPortal',
    'createRoot',
    'dispose',
    'events',
    'extend',
    'flushGlobalEffects',
    'flushSync',
    'getRootState',
    'invalidate',
    'reconciler',
    'unmountComponentAtNode',
    'useFrame',
    'useGraph',
    'useInstanceHandle',
    'useLoader',
    'useStore',
    'useThree',
  ],
};

const entryFile = fileURLToPath(import.meta.url);
const here = dirname(entryFile);
const require = createRequire(import.meta.url);
const REACT_ALIASES = [
  { find: /^react$/, replacement: require.resolve('react') },
  { find: /^react\/jsx-runtime$/, replacement: require.resolve('react/jsx-runtime') },
  { find: /^react\/jsx-dev-runtime$/, replacement: require.resolve('react/jsx-dev-runtime') },
  { find: /^react-dom$/, replacement: require.resolve('react-dom') },
  { find: /^react-dom\/client$/, replacement: require.resolve('react-dom/client') },
];
const editorShellEntry = resolve(
  here,
  'client',
  entryFile.endsWith('.ts') ? 'editor-shell.tsx' : 'editor-shell.js',
);
const clientPublicEntry = resolve(
  here,
  entryFile.endsWith('.ts') || existsSync(resolve(here, 'client-public.ts'))
    ? 'client-public.ts'
    : existsSync(resolve(here, '../src/client-public.ts'))
      ? '../src/client-public.ts'
      : 'client-public.js',
);
const editorShellImport = entryFile.endsWith('.ts')
  ? fsModulePath(editorShellEntry)
  : 'immersive-web-editor/editor-shell';

function fsModulePath(file: string): string {
  return `/@fs/${normalizePath(resolve(file))}`;
}

function clientModulePath(client: string): string {
  return isBareModuleId(client) ? client : fsModulePath(client);
}

function clientBundleModulePath(client: string, root: string): string {
  if (isBareModuleId(client)) return client;
  return resolve(root, client);
}

function isBareModuleId(value: string): boolean {
  return !value.startsWith('/') && !value.startsWith('.') && !/^[A-Za-z]:[\\/]/.test(value);
}

interface ConfigurableRecord {
  id: string;
  panel: string;
  path: string[];
  value: unknown;
  file: string;
  relativeFile: string;
  line: number;
  column: number;
  start: number;
  end: number;
  source: string;
}

interface ConfigurableCall {
  id: string;
  panel: string;
  path: string[];
  openParen: number;
  valueStart: number;
  valueEnd: number;
  value: unknown;
}

interface ScanState {
  quote: '"' | "'" | '`' | null;
  lineComment: boolean;
  blockComment: boolean;
  escaped: boolean;
  templateDepth: number;
}

const IDENTIFIER_RE = /[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*/u;
function normalizePath(path: string): string {
  return path.split(sep).join('/');
}

function stripQuery(id: string): string {
  const queryIndex = id.indexOf('?');
  return queryIndex === -1 ? id : id.slice(0, queryIndex);
}

function queryValue(id: string, key: string): string | null {
  const queryIndex = id.indexOf('?');
  if (queryIndex === -1) return null;
  return new URLSearchParams(id.slice(queryIndex + 1)).get(key);
}

function isTransformableModule(id: string): boolean {
  const file = stripQuery(id);
  if (file.includes('/node_modules/') || file.startsWith('\0')) return false;
  return /\.[cm]?[jt]sx?$/.test(file);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function importedAliases(code: string): {
  configs: Set<string>;
  values: Set<string>;
} {
  const configs = new Set<string>();
  const values = new Set<string>();
  const importPattern = new RegExp(
    String.raw`import\s*\{([^}]+)\}\s*from\s*['"]${escapeRegExp(CONFIGURABLE_MODULE_ID)}['"]`,
    'g',
  );

  for (const match of code.matchAll(importPattern)) {
    const specifiers = match[1]?.split(',') ?? [];
    for (const specifier of specifiers) {
      const parts = specifier.trim().split(/\s+as\s+/);
      const imported = parts[0]?.trim();
      if (!imported) continue;
      const local = (parts[1] ?? imported).trim();
      if (!IDENTIFIER_RE.test(local)) continue;
      if (imported === 'config' || imported === 'configurable') configs.add(local);
      if (imported === 'val') values.add(local);
    }
  }

  return { configs, values };
}

function isIdentifierChar(char: string | undefined): boolean {
  return Boolean(char && /[$_\u200c\u200d\p{ID_Continue}]/u.test(char));
}

function advanceScanState(code: string, index: number, state: ScanState): void {
  const char = code[index];
  const next = code[index + 1];

  if (state.lineComment) {
    if (char === '\n') state.lineComment = false;
    return;
  }

  if (state.blockComment) {
    if (char === '*' && next === '/') {
      state.blockComment = false;
    }
    return;
  }

  if (state.quote) {
    if (state.escaped) {
      state.escaped = false;
      return;
    }
    if (char === '\\') {
      state.escaped = true;
      return;
    }
    if (state.quote === '`' && char === '$' && next === '{') {
      state.templateDepth++;
      return;
    }
    if (state.quote === '`' && char === '}' && state.templateDepth > 0) {
      state.templateDepth--;
      return;
    }
    if (char === state.quote && state.templateDepth === 0) {
      state.quote = null;
    }
    return;
  }

  if (char === '/' && next === '/') {
    state.lineComment = true;
    return;
  }
  if (char === '/' && next === '*') {
    state.blockComment = true;
    return;
  }
  if (char === '"' || char === "'" || char === '`') {
    state.quote = char;
  }
}

function skipWhitespace(code: string, index: number): number {
  let cursor = index;
  while (/\s/.test(code[cursor] ?? '')) cursor++;
  return cursor;
}

function findCallEnd(code: string, openParen: number): { comma: number; close: number } | null {
  let depth = 1;
  let firstTopLevelComma = -1;
  const state: ScanState = { quote: null, lineComment: false, blockComment: false, escaped: false, templateDepth: 0 };

  for (let index = openParen + 1; index < code.length; index++) {
    advanceScanState(code, index, state);
    if (state.quote || state.lineComment || state.blockComment) continue;

    const char = code[index];
    if (char === '(' || char === '[' || char === '{') depth++;
    if (char === ')' || char === ']' || char === '}') depth--;
    if (char === ',' && depth === 1 && firstTopLevelComma === -1) firstTopLevelComma = index;
    if (char === ')' && depth === 0) return { comma: firstTopLevelComma, close: index };
  }

  return null;
}

function splitTopLevelArgs(code: string, openParen: number, closeParen: number): Array<{ start: number; end: number }> {
  const args: Array<{ start: number; end: number }> = [];
  const state: ScanState = { quote: null, lineComment: false, blockComment: false, escaped: false, templateDepth: 0 };
  let depth = 0;
  let start = openParen + 1;

  for (let index = openParen + 1; index < closeParen; index++) {
    advanceScanState(code, index, state);
    if (state.quote || state.lineComment || state.blockComment) continue;

    const char = code[index];
    if (char === '(' || char === '[' || char === '{') depth++;
    if (char === ')' || char === ']' || char === '}') depth--;
    if (char !== ',' || depth !== 0) continue;

    args.push(trimRange(code, start, index));
    start = index + 1;
  }

  const last = trimRange(code, start, closeParen);
  if (last.start < last.end) args.push(last);
  return args;
}

function trimRange(code: string, start: number, end: number): { start: number; end: number } {
  let nextStart = start;
  let nextEnd = end;
  while (nextStart < nextEnd && /\s/.test(code[nextStart] ?? '')) nextStart++;
  while (nextEnd > nextStart && /\s/.test(code[nextEnd - 1] ?? '')) nextEnd--;
  return { start: nextStart, end: nextEnd };
}

function parseJsonSource(code: string, range: { start: number; end: number }, context: string): unknown {
  const source = code.slice(range.start, range.end);
  try {
    return JSON.parse(source) as unknown;
  } catch (err) {
    const { line, column } = positionAt(code, range.start);
    throw new Error(`${context} must be raw JSON at ${line}:${column}. Received ${JSON.stringify(source)}. ${(err as Error).message}`);
  }
}

function parseStringLiteralSource(code: string, range: { start: number; end: number }, context: string): string {
  const source = code.slice(range.start, range.end);
  try {
    const parsed = JSON.parse(source) as unknown;
    if (typeof parsed === 'string') return parsed;
  } catch {
    // Fall through to the small JS-string parser below.
  }
  const quote = source[0];
  if ((quote === '"' || quote === "'") && source[source.length - 1] === quote) {
    let value = '';
    for (let index = 1; index < source.length - 1; index++) {
      const char = source[index];
      if (char === '\\') {
        const next = source[index + 1];
        value += next === 'n' ? '\n'
          : next === 'r' ? '\r'
            : next === 't' ? '\t'
              : next ?? '';
        index++;
      } else {
        value += char;
      }
    }
    return value;
  }
  const { line, column } = positionAt(code, range.start);
  throw new Error(`${context} must be a string literal at ${line}:${column}.`);
}

function findMatchingBracket(code: string, openIndex: number, openChar: string, closeChar: string): number {
  let depth = 1;
  const state: ScanState = { quote: null, lineComment: false, blockComment: false, escaped: false, templateDepth: 0 };
  for (let index = openIndex + 1; index < code.length; index++) {
    advanceScanState(code, index, state);
    if (state.quote || state.lineComment || state.blockComment) continue;
    if (code[index] === openChar) depth++;
    if (code[index] === closeChar) depth--;
    if (depth === 0) return index;
  }
  return -1;
}

function splitObjectProperties(
  code: string,
  openBrace: number,
  closeBrace: number,
): Array<{ key: string; value: { start: number; end: number } }> {
  const properties: Array<{ key: string; value: { start: number; end: number } }> = [];
  const state: ScanState = { quote: null, lineComment: false, blockComment: false, escaped: false, templateDepth: 0 };
  let depth = 0;
  let start = openBrace + 1;

  function pushProperty(end: number): void {
    const range = trimRange(code, start, end);
    if (range.start >= range.end) return;
    const colon = findTopLevelColon(code, range.start, range.end);
    if (colon === -1) return;
    const keySource = code.slice(range.start, colon).trim();
    const key = parseObjectKey(keySource);
    if (!key) return;
    properties.push({ key, value: trimRange(code, colon + 1, range.end) });
  }

  for (let index = openBrace + 1; index < closeBrace; index++) {
    advanceScanState(code, index, state);
    if (state.quote || state.lineComment || state.blockComment) continue;
    const char = code[index];
    if (char === '(' || char === '[' || char === '{') depth++;
    if (char === ')' || char === ']' || char === '}') depth--;
    if (char !== ',' || depth !== 0) continue;
    pushProperty(index);
    start = index + 1;
  }
  pushProperty(closeBrace);
  return properties;
}

function findTopLevelColon(code: string, start: number, end: number): number {
  const state: ScanState = { quote: null, lineComment: false, blockComment: false, escaped: false, templateDepth: 0 };
  let depth = 0;
  for (let index = start; index < end; index++) {
    advanceScanState(code, index, state);
    if (state.quote || state.lineComment || state.blockComment) continue;
    const char = code[index];
    if (char === '(' || char === '[' || char === '{') depth++;
    if (char === ')' || char === ']' || char === '}') depth--;
    if (char === ':' && depth === 0) return index;
  }
  return -1;
}

function parseObjectKey(source: string): string | null {
  if (IDENTIFIER_RE.test(source)) return source;
  try {
    const value = JSON.parse(source) as unknown;
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function findValueCall(
  code: string,
  range: { start: number; end: number },
  values: Set<string>,
): ConfigurableCall | null {
  const cursor = skipWhitespace(code, range.start);
  const alias = [...values].find((candidate) => (
    code.startsWith(candidate, cursor) && !isIdentifierChar(code[cursor + candidate.length])
  ));
  if (!alias) return null;

  const openParen = skipWhitespace(code, cursor + alias.length);
  if (code[openParen] !== '(') return null;
  const callEnd = findCallEnd(code, openParen);
  if (!callEnd || skipWhitespace(code, callEnd.close + 1) !== range.end) return null;

  const args = splitTopLevelArgs(code, openParen, callEnd.close);
  const maybeMeta = safeJsonParse(code.slice(args[0]?.start ?? 0, args[0]?.end ?? 0));
  const hasInjectedId = Boolean(
    maybeMeta
      && typeof maybeMeta === 'object'
      && typeof (maybeMeta as { id?: unknown }).id === 'string'
      && ((maybeMeta as { id: string }).id).includes('editor:'),
  );
  const valueArg = args[hasInjectedId ? 1 : 0];
  if (!valueArg) {
    const { line, column } = positionAt(code, openParen);
    throw new Error(`val(...) needs a raw JSON current value at ${line}:${column}.`);
  }

  const value = parseJsonSource(code, valueArg, 'val(...) current value');

  return {
    id: '',
    panel: '',
    path: [],
    openParen,
    valueStart: valueArg.start,
    valueEnd: valueArg.end,
    value,
  };
}

function safeJsonParse(source: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    return undefined;
  }
}

function collectValueCallsInShape(
  code: string,
  range: { start: number; end: number },
  panel: string,
  path: string[],
  values: Set<string>,
): ConfigurableCall[] {
  const valueCall = findValueCall(code, range, values);
  if (valueCall) return [{ ...valueCall, panel, path }];

  const cursor = skipWhitespace(code, range.start);
  if (code[cursor] !== '{') return [];
  const close = findMatchingBracket(code, cursor, '{', '}');
  if (close === -1 || skipWhitespace(code, close + 1) !== range.end) return [];

  return splitObjectProperties(code, cursor, close).flatMap((property) => (
    collectValueCallsInShape(code, property.value, panel, [...path, property.key], values)
  ));
}

function findConfigurableCalls(code: string, aliases: ReturnType<typeof importedAliases>): ConfigurableCall[] {
  if (aliases.configs.size === 0 || aliases.values.size === 0) return [];

  const calls: ConfigurableCall[] = [];
  const state: ScanState = { quote: null, lineComment: false, blockComment: false, escaped: false, templateDepth: 0 };

  for (let index = 0; index < code.length; index++) {
    advanceScanState(code, index, state);
    if (state.quote || state.lineComment || state.blockComment) continue;
    if (isIdentifierChar(code[index - 1])) continue;

    for (const alias of aliases.configs) {
      if (!code.startsWith(alias, index) || isIdentifierChar(code[index + alias.length])) continue;
      const openParen = skipWhitespace(code, index + alias.length);
      if (code[openParen] !== '(') continue;
      const end = findCallEnd(code, openParen);
      if (!end) continue;
      const args = splitTopLevelArgs(code, openParen, end.close);
      const hasInjectedId = args.length >= 3 && typeof safeJsonParse(code.slice(args[0].start, args[0].end)) === 'string'
        && code.slice(args[0].start, args[0].end).includes('editor:');
      const labelArg = args[hasInjectedId ? 1 : 0];
      const shapeArg = args[hasInjectedId ? 2 : 1];
      if (!labelArg || !shapeArg) continue;
      const label = parseStringLiteralSource(code, labelArg, 'config(...) label');
      calls.push(...collectValueCallsInShape(
        code,
        shapeArg,
        label,
        [],
        aliases.values,
      ));
      index = end.close;
      break;
    }
  }

  return calls;
}

function positionAt(code: string, index: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let cursor = 0; cursor < index; cursor++) {
    if (code[cursor] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

function configurableId(relativeFile: string, line: number, column: number): string {
  return `editor:${relativeFile}:${line}:${column}`;
}

function collectConfigurables(code: string, file: string, root: string): { code: string; records: ConfigurableRecord[] } | null {
  const aliases = importedAliases(code);
  const calls = findConfigurableCalls(code, aliases);
  if (calls.length === 0) return null;

  const relativeFile = normalizePath(relative(root, file));
  const records: ConfigurableRecord[] = [];
  let transformed = code;

  for (const call of [...calls].reverse()) {
    const { line, column } = positionAt(code, call.valueStart);
    const id = configurableId(relativeFile, line, column);
    records.unshift({
      id,
      panel: call.panel,
      path: call.path,
      value: call.value,
      file,
      relativeFile,
      line,
      column,
      start: call.valueStart,
      end: call.valueEnd,
      source: code.slice(call.valueStart, call.valueEnd),
    });
    transformed = `${transformed.slice(0, call.openParen + 1)}${JSON.stringify({ id, panel: call.panel, path: call.path })}, ${transformed.slice(call.openParen + 1)}`;
  }

  return { code: transformed, records };
}

function sendJson(res: ServerResponse, statusCode: number, value: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(value));
}

function editorApiError(message: string): EditorApiErrorResponse {
  return { error: message };
}

function publicConfigurable(record: ConfigurableRecord): object {
  return {
    id: record.id,
    panel: record.panel,
    path: record.path,
    value: record.value,
    file: record.relativeFile,
    line: record.line,
    column: record.column,
    source: record.source,
  };
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return readRequestBuffer(req).then((body) => body.toString('utf8'));
}

function readRequestBuffer(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

interface UploadedEditorFile {
  fileName: string;
  contentType: string;
  data: Buffer;
}

function editorPublicDir(server: ViteDevServer, root: string): string | null {
  const configuredPublicDir = (server.config as { publicDir?: string | false }).publicDir;
  if (configuredPublicDir === false) return null;
  return typeof configuredPublicDir === 'string' && configuredPublicDir.length > 0
    ? configuredPublicDir
    : resolve(root, 'public');
}

function listPublicFiles(publicDir: string): PublicFile[] {
  if (!existsSync(publicDir)) return [];
  const files: PublicFile[] = [];
  const visit = (dir: string, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.DS_Store') continue;
      const absolute = resolve(dir, entry.name);
      const fileName = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        visit(absolute, fileName);
        continue;
      }
      if (!entry.isFile()) continue;
      const stats = statSync(absolute);
      files.push({
        fileName,
        url: `/${fileName.split('/').map((part) => encodeURIComponent(part)).join('/')}`,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      });
    }
  };
  visit(publicDir);
  return files.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' }));
}

function parseMultipartUpload(req: IncomingMessage, body: Buffer): UploadedEditorFile {
  const contentType = String(req.headers['content-type'] ?? '');
  const boundaryMatch = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) throw new Error('Upload requires multipart/form-data.');

  const boundaryBuffer = Buffer.from(`--${boundary}`);
  let cursor = body.indexOf(boundaryBuffer);
  while (cursor !== -1) {
    let partStart = cursor + boundaryBuffer.length;
    if (body.subarray(partStart, partStart + 2).toString('utf8') === '--') break;
    if (body.subarray(partStart, partStart + 2).toString('utf8') === '\r\n') partStart += 2;

    const nextBoundary = body.indexOf(boundaryBuffer, partStart);
    if (nextBoundary === -1) break;

    let part = body.subarray(partStart, nextBoundary);
    if (part.length >= 2 && part.subarray(part.length - 2).toString('utf8') === '\r\n') {
      part = part.subarray(0, part.length - 2);
    }

    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString('utf8');
      const data = part.subarray(headerEnd + 4);
      const disposition = /^content-disposition:\s*(.+)$/im.exec(headers)?.[1] ?? '';
      const fileName = dispositionParameter(disposition, 'filename');
      if (fileName) {
        return {
          fileName,
          contentType: /^content-type:\s*(.+)$/im.exec(headers)?.[1]?.trim() ?? 'application/octet-stream',
          data,
        };
      }
    }

    cursor = nextBoundary;
  }

  throw new Error('Upload did not include a file.');
}

function dispositionParameter(disposition: string, key: string): string | null {
  const match = new RegExp(`${key}="([^"]*)"`).exec(disposition);
  if (!match) return null;
  return match[1].replace(/\\"/g, '"').trim() || null;
}

function publicUploadFileName(originalFileName: string, publicDir: string): string {
  const raw = basename(originalFileName).replace(/\0/g, '').trim();
  const extension = extname(raw).replace(/[^A-Za-z0-9.]/g, '').slice(0, 32);
  const stem = basename(raw, extname(raw))
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'upload';
  const baseName = `${stem}${extension}`;
  if (!existsSync(resolve(publicDir, baseName))) return baseName;

  for (let index = 1; index < 10_000; index++) {
    const candidate = `${stem}-${index}${extension}`;
    if (!existsSync(resolve(publicDir, candidate))) return candidate;
  }
  throw new Error('Could not choose a unique file name.');
}

function parseReplacementBody(req: IncomingMessage, body: string): string {
  const contentType = req.headers['content-type'] ?? '';
  if (!String(contentType).includes('application/json')) {
    JSON.parse(body);
    return body;
  }

  const parsed = JSON.parse(body) as unknown;
  if (parsed && typeof parsed === 'object') {
    const object = parsed as { code?: unknown; value?: unknown };
    if (typeof object.code === 'string') {
      JSON.parse(object.code);
      return object.code;
    }
    if ('value' in object) return JSON.stringify(object.value);
  }
  return JSON.stringify(parsed);
}

function findPropertyValueEnd(code: string, start: number): number {
  const state: ScanState = { quote: null, lineComment: false, blockComment: false, escaped: false, templateDepth: 0 };
  let depth = 0;

  for (let index = start; index < code.length; index++) {
    advanceScanState(code, index, state);
    if (state.quote || state.lineComment || state.blockComment) continue;

    const char = code[index];
    if (char === '(' || char === '[' || char === '{') depth++;
    if (char === ')' || char === ']' || char === '}') {
      if (depth === 0) return index;
      depth--;
    }
    if (char === ',' && depth === 0) return index;
  }

  return code.length;
}

function findImportInsertionIndex(code: string): number {
  let cursor = 0;
  let lastImportEnd = 0;

  while (cursor < code.length) {
    cursor = skipWhitespace(code, cursor);
    if (!code.startsWith('import', cursor) || isIdentifierChar(code[cursor + 'import'.length])) break;
    const end = code.indexOf(';', cursor);
    if (end === -1) break;
    lastImportEnd = end + 1;
    cursor = end + 1;
  }

  return lastImportEnd;
}

function editorComponentUrl(file: string, index: number): string {
  const params = new URLSearchParams({ file, index: String(index) });
  return `${EDITOR_STATIC_COMPONENT_PATH}?${params.toString()}`;
}

interface EditorComponentExtraction {
  start: number;
  end: number;
  source: string;
}

function findEditorComponentValues(code: string): EditorComponentExtraction[] {
  const matches: EditorComponentExtraction[] = [];
  const state: ScanState = { quote: null, lineComment: false, blockComment: false, escaped: false, templateDepth: 0 };

  for (let index = 0; index < code.length; index++) {
    advanceScanState(code, index, state);
    if (state.quote || state.lineComment || state.blockComment) continue;
    if (isIdentifierChar(code[index - 1])) continue;
    if (!code.startsWith('component', index) || isIdentifierChar(code[index + 'component'.length])) continue;

    const colon = skipWhitespace(code, index + 'component'.length);
    if (code[colon] !== ':') continue;
    const start = skipWhitespace(code, colon + 1);
    const end = trimRange(code, start, findPropertyValueEnd(code, start)).end;
    const source = code.slice(start, end);
    if (!/["']use editor["']/.test(source)) continue;
    matches.push({ start, end, source });
    index = end;
  }

  return matches;
}

function extractEditorComponents(
  code: string,
  file: string,
  options: { exportIndex?: number } = {},
): string {
  const matches = findEditorComponentValues(code);
  if (matches.length === 0) return code;

  let transformed = code;
  const declarations: string[] = [];
  const includeDeclarations = options.exportIndex !== undefined;

  for (let index = matches.length - 1; index >= 0; index--) {
    const match = matches[index]!;
    const name = `__editor_component_${index}`;
    if (includeDeclarations) declarations.unshift(`const ${name} = ${match.source};`);
    transformed = `${transformed.slice(0, match.start)}${JSON.stringify({
      module: editorComponentUrl(file, index),
      exportName: name,
    })}${transformed.slice(match.end)}`;
  }

  if (includeDeclarations) {
    const insertAt = findImportInsertionIndex(transformed);
    transformed = `${transformed.slice(0, insertAt)}\n${declarations.join('\n')}\n${transformed.slice(insertAt)}`;
    const name = `__editor_component_${options.exportIndex}`;
    transformed += `\nexport { ${name} };\n`;
  }

  return transformed;
}

function renderEditorShell(): string {
  // Skeleton HTML for /editor. The shell reads runtime/editor-plugin wiring from
  // virtual:editor/config so dev and static builds use the same module graph.
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Editor</title>
    <script>
      window.$RefreshReg$ = window.$RefreshReg$ || (() => {});
      window.$RefreshSig$ = window.$RefreshSig$ || (() => (type) => type);
      window.__vite_plugin_react_preamble_installed__ = true;
    </script>
    <script type="importmap">
      ${JSON.stringify({ imports: staticEditorImportMap() })}
    </script>
    <script type="module" src="${EDITOR_STATIC_SHELL_PATH}"></script>
  </head>
  <body></body>
</html>
`;
}

function staticEditorImportMap(): Record<string, string> {
  return {
    ...Object.fromEntries(
    STATIC_SHARED_IMPORTS.map((id) => [id, `${EDITOR_STATIC_SHARED_PREFIX}${encodeURIComponent(id)}.js`]),
    ),
    'three/': `${EDITOR_STATIC_SHARED_PREFIX}three/`,
  };
}

function renderEditorBuildShell(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Editor</title>
    <script>
      window.$RefreshReg$ = window.$RefreshReg$ || (() => {});
      window.$RefreshSig$ = window.$RefreshSig$ || (() => (type) => type);
      window.__vite_plugin_react_preamble_installed__ = true;
    </script>
    <script type="module">
      import '${EDITOR_SHELL_VIRTUAL_ID}';
    </script>
  </head>
  <body></body>
</html>
`;
}

function renderEditorConfigModule(plugins: EditorPlugin[], previewUrl: string): string {
  const pluginModules = plugins
    .filter((plugin) => plugin.client)
    .map((plugin, index) => ({
      name: plugin.name,
      importName: `plugin${index}`,
      module: `${EDITOR_PLUGIN_VIRTUAL_PREFIX}${index}`,
    }));
  const pluginCommands = plugins.flatMap((plugin) => plugin.commands ?? []);

  return `${pluginModules.map((plugin) => `import * as ${plugin.importName} from ${JSON.stringify(plugin.module)};`).join('\n')}

export const previewUrl = ${JSON.stringify(previewUrl)};
export const pluginModules = [
${pluginModules.map((plugin) => `  { name: ${JSON.stringify(plugin.name)}, module: ${plugin.importName} },`).join('\n')}
];
export const pluginCommands = ${JSON.stringify(pluginCommands)};
`;
}

async function buildStaticEditorShell(
  root: string,
  plugins: EditorPlugin[],
  clientPlugins: EditorPlugin[],
  previewUrl: string,
): Promise<string> {
  const result = await buildWithEsbuild({
    entryPoints: [editorShellEntry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: 'inline',
    external: STATIC_SHARED_EXTERNALS,
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
    },
    plugins: [staticEditorVirtualModules(root, plugins, clientPlugins, previewUrl)],
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error('Static editor shell build produced no output.');
  return output.text;
}

async function buildStaticSharedModule(root: string, id: string): Promise<string> {
  if (!STATIC_SHARED_IMPORTS.includes(id as (typeof STATIC_SHARED_IMPORTS)[number]) && !id.startsWith('three/')) {
    throw new Error(`Unknown static editor shared module "${id}".`);
  }
  const resolved = resolveStaticSharedModule(id);
  const contents = id === 'react'
    ? `import React from ${JSON.stringify(resolved)};
export default React;
export const {
  Activity,
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
  __COMPILER_RUNTIME,
  act,
  cache,
  cacheSignal,
  captureOwnerStack,
  cloneElement,
  createContext,
  createElement,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  unstable_useCacheRefresh,
  use,
  useActionState,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
} = React;`
    : id === 'react/jsx-runtime'
    ? `import runtime from ${JSON.stringify(resolved)};
export const jsx = runtime.jsx;
export const jsxs = runtime.jsxs;
export const Fragment = runtime.Fragment;`
    : id === 'react/jsx-dev-runtime'
      ? `import runtime from ${JSON.stringify(resolved)};
export const jsxDEV = runtime.jsxDEV;
export const Fragment = runtime.Fragment;`
      : id === 'react-dom/client'
        ? `import runtime from ${JSON.stringify(resolved)}; export const createRoot = runtime.createRoot; export const hydrateRoot = runtime.hydrateRoot;`
        : id in STATIC_NAMED_EXPORTS
          ? namedSharedModuleContents(resolved, STATIC_NAMED_EXPORTS[id as keyof typeof STATIC_NAMED_EXPORTS]!)
        : `export * from ${JSON.stringify(resolved)};`;
  const result = await buildWithEsbuild({
    stdin: {
      contents,
      sourcefile: `${id}.js`,
      resolveDir: dirname(resolved),
      loader: 'js',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    external: STATIC_SHARED_EXTERNALS.filter((external) => external !== id),
    banner: { js: staticRequireShim(id) },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
    },
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error(`Static editor shared module "${id}" produced no output.`);
  return output.text;
}

function staticRequireShim(id: string): string {
  const imports = id === 'react-dom/client'
    ? ['react', 'react-dom']
    : id === 'react-dom'
      ? ['react']
    : id === 'react/jsx-runtime' || id === 'react/jsx-dev-runtime'
      ? ['react']
    : id === '@immersive-web-editor/ui'
      ? ['react', 'react-dom']
    : id === '@react-three/fiber'
      ? ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'three']
      : id === '@react-three/handle' || id === '@react-three/xr'
        ? ['react', 'three']
        : [];
  if (imports.length === 0) return '';
  const importLines = imports
    .map((sharedId, index) => `import * as __editor_static_${index} from ${JSON.stringify(sharedId)};`)
    .join('\n');
  const cases = imports
    .map((sharedId, index) => `    case ${JSON.stringify(sharedId)}: return __editor_static_${index};`)
    .join('\n');
  return `${importLines}
const require = (moduleId) => {
  switch (moduleId) {
${cases}
    default: throw new Error(\`Unsupported static editor require: \${moduleId}\`);
  }
};`;
}

function resolveStaticSharedModule(id: string): string {
  if (id === 'three') return resolve(dirname(require.resolve('three')), 'three.module.js');
  try {
    return require.resolve(id);
  } catch {
    return fileURLToPath((import.meta as unknown as { resolve(specifier: string): string }).resolve(id));
  }
}

function namedSharedModuleContents(resolved: string, names: string[]): string {
  return `import runtime, * as namespace from ${JSON.stringify(resolved)};
const api = Object.keys(namespace).some((key) => key !== 'default') ? namespace : runtime;
export default runtime;
${names.map((name) => `export const ${name} = api.${name};`).join('\n')}`;
}

async function buildStaticEditorComponent(file: string, index: number): Promise<string> {
  const code = readFileSync(file, 'utf8');
  const result = await buildWithEsbuild({
    stdin: {
      contents: extractEditorComponents(code, file, { exportIndex: index }),
      sourcefile: file,
      resolveDir: dirname(file),
      loader: file.endsWith('.tsx') || file.endsWith('.jsx') ? 'tsx' : file.endsWith('.ts') ? 'ts' : 'js',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: 'inline',
    external: STATIC_SHARED_EXTERNALS,
    plugins: [staticEditorSourceAlias()],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
    },
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error(`Static editor component "${file}" produced no output.`);
  return output.text;
}

function staticEditorSourceAlias(): EsbuildPlugin {
  return {
    name: 'immersive-web-editor-source-alias',
    setup(build) {
      build.onResolve({ filter: new RegExp(`^${escapeRegExp(CONFIGURABLE_MODULE_ID)}$`) }, () => ({
        path: clientPublicEntry,
      }));
    },
  };
}

function staticEditorVirtualModules(
  root: string,
  plugins: EditorPlugin[],
  clientPlugins: EditorPlugin[],
  previewUrl: string,
): EsbuildPlugin {
  return {
    name: 'immersive-web-editor-static-virtual-modules',
    setup(build) {
      build.onResolve({ filter: new RegExp(`^${escapeRegExp(EDITOR_CONFIG_VIRTUAL_ID)}$`) }, () => ({
        path: EDITOR_CONFIG_VIRTUAL_ID,
        namespace: 'editor-virtual',
      }));
      build.onResolve({ filter: new RegExp(`^${escapeRegExp(EDITOR_PLUGIN_VIRTUAL_PREFIX)}\\d+$`) }, (args) => ({
        path: args.path,
        namespace: 'editor-virtual',
      }));
      build.onLoad({ filter: /.*/, namespace: 'editor-virtual' }, (args) => {
        if (args.path === EDITOR_CONFIG_VIRTUAL_ID) {
          return {
            contents: renderEditorConfigModule(plugins, previewUrl),
            loader: 'js',
            resolveDir: root,
          };
        }
        if (args.path.startsWith(EDITOR_PLUGIN_VIRTUAL_PREFIX)) {
          const index = Number(args.path.slice(EDITOR_PLUGIN_VIRTUAL_PREFIX.length));
          const plugin = clientPlugins[index];
          const client = plugin?.client;
          return {
            contents: client ? `export * from ${JSON.stringify(clientBundleModulePath(client, root))};` : '',
            loader: 'js',
            resolveDir: root,
          };
        }
        return null;
      });
    },
  };
}

export default function editorPlugin(options: EditorOptions = {}): Plugin {
  const plugins = options.plugins ?? [];
  const clientPlugins = plugins.filter((plugin) => plugin.client);
  const configurablesByFile = new Map<string, ConfigurableRecord[]>();
  const configurablesById = new Map<string, ConfigurableRecord>();
  let wsToken = '';
  let transformCalls = 0;
  let root = process.cwd();
  let buildOutDir = '';
  let previewUrl = DEFAULT_PREVIEW_URL;
  const staticSharedModulePromises = new Map<string, Promise<string>>();

  function replaceFileConfigurables(file: string, records: ConfigurableRecord[]): void {
    const previous = configurablesByFile.get(file) ?? [];
    for (const record of previous) configurablesById.delete(record.id);
    if (records.length === 0) {
      configurablesByFile.delete(file);
      return;
    }
    configurablesByFile.set(file, records);
    for (const record of records) configurablesById.set(record.id, record);
  }

  function getStaticEditorShell(): Promise<string> {
    return buildStaticEditorShell(root, plugins, clientPlugins, previewUrl);
  }

  function getStaticSharedModule(id: string): Promise<string> {
    let promise = staticSharedModulePromises.get(id);
    if (!promise) {
      promise = buildStaticSharedModule(root, id);
      staticSharedModulePromises.set(id, promise);
    }
    return promise;
  }

  return {
    name: 'immersive-web-editor',
    apply(_config, env) {
      return env.command === 'serve' || options.build?.enabled === true;
    },
    enforce: 'pre',

    config(_config, env) {
      const sharedConfig = {
        resolve: {
          alias: [
            ...REACT_ALIASES,
            { find: new RegExp(`^${escapeRegExp(CONFIGURABLE_MODULE_ID)}$`), replacement: clientPublicEntry },
          ],
          dedupe: REACT_DEDUPE,
        },
      };
      if (env.command !== 'build' || options.build?.enabled !== true) return sharedConfig;
      previewUrl = options.build.previewUrl ?? DEFAULT_PREVIEW_URL;
      return {
        ...sharedConfig,
        build: {
          rollupOptions: {
            input: {
              index: EDITOR_BUILD_HTML_ID,
            },
          },
        },
      };
    },

    configResolved(config) {
      root = config.root;
      buildOutDir = config.build.outDir;
      // Pin wsToken to a stable value. Vite's default rotates per-restart via
      // crypto.getRandomValues; because the Worker may kill+restart Vite while
      // multiple browser requests are in flight, a rotated token makes the
      // HTML and @vite/client validate against a Vite that's using a
      // different token, producing intermittent WS upgrade 400s.
      //
      // Vite is only reachable via the Cloudflare Worker proxy, so the
      // anti-CSRF property Vite's random token provides isn't load-bearing.
      const STABLE_TOKEN = 'editor-ws';
      (config as unknown as { webSocketToken: string }).webSocketToken = STABLE_TOKEN;
      wsToken = STABLE_TOKEN;
    },

    transform(code, id) {
      if (!isTransformableModule(id)) return null;
      const file = stripQuery(id);
      const editorComponentIndex = queryValue(id, EDITOR_COMPONENT_QUERY);
      if (editorComponentIndex !== null) {
        return {
          code: extractEditorComponents(code, file, { exportIndex: Number(editorComponentIndex) }),
          map: null,
        };
      }

      const result = collectConfigurables(code, file, root);
      const nextCode = extractEditorComponents(result?.code ?? code, file);

      replaceFileConfigurables(file, result?.records ?? []);
      if (!result && nextCode === code) return null;

      return { code: nextCode, map: null };
    },

    resolveId(id) {
      if (id === EDITOR_BUILD_HTML_ID) return EDITOR_BUILD_HTML_ID;
      if (id === EDITOR_SHELL_VIRTUAL_ID) return `\0${EDITOR_SHELL_VIRTUAL_ID}`;
      if (id === EDITOR_CONFIG_VIRTUAL_ID) return `\0${EDITOR_CONFIG_VIRTUAL_ID}`;
      if (id.startsWith(EDITOR_PLUGIN_VIRTUAL_PREFIX)) return `\0${id}`;
      return null;
    },

    load(id) {
      if (id === EDITOR_BUILD_HTML_ID) return renderEditorBuildShell();
      if (id === `\0${EDITOR_SHELL_VIRTUAL_ID}`) return `import ${JSON.stringify(editorShellImport)};`;
      if (id === `\0${EDITOR_CONFIG_VIRTUAL_ID}`) return renderEditorConfigModule(plugins, previewUrl);
      if (id.startsWith(`\0${EDITOR_PLUGIN_VIRTUAL_PREFIX}`)) {
        const index = Number(id.slice(`\0${EDITOR_PLUGIN_VIRTUAL_PREFIX}`.length));
        const plugin = clientPlugins[index];
        if (!plugin?.client) return null;
        return `export * from ${JSON.stringify(clientModulePath(plugin.client))};`;
      }
      return null;
    },

    closeBundle() {
      if (options.build?.enabled !== true || !buildOutDir) return;
      const htmlSource = resolve(buildOutDir, EDITOR_BUILD_HTML_ID);
      const htmlTarget = resolve(buildOutDir, 'index.html');
      if (!existsSync(htmlSource)) return;
      rmSync(htmlTarget, { force: true });
      renameSync(htmlSource, htmlTarget);
      rmSync(resolve(buildOutDir, 'virtual:editor'), { recursive: true, force: true });
    },

    async configureServer(server) {
      const log = server.config.logger;
      for (const plugin of plugins) {
        await plugin.configureServer?.({ server });
      }

      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        const pathname = new URL(url, 'http://editor.local').pathname;

        if (pathname === EDITOR_STATIC_SHELL_PATH) {
          try {
            res.setHeader('content-type', 'text/javascript; charset=utf-8');
            res.setHeader('cache-control', 'no-store');
            res.end(await getStaticEditorShell());
          } catch (err) {
            sendJson(res, 500, editorApiError((err as Error).message));
          }
          return;
        }

        if (pathname.startsWith(EDITOR_STATIC_SHARED_PREFIX) && pathname.endsWith('.js')) {
          try {
            const encoded = pathname.slice(EDITOR_STATIC_SHARED_PREFIX.length);
            const decoded = decodeURIComponent(encoded);
            const id = decoded.startsWith('three/') ? decoded : decoded.slice(0, -'.js'.length);
            res.setHeader('content-type', 'text/javascript; charset=utf-8');
            res.setHeader('cache-control', 'no-store');
            res.end(await getStaticSharedModule(id));
          } catch (err) {
            sendJson(res, 500, editorApiError((err as Error).message));
          }
          return;
        }

        if (pathname === EDITOR_STATIC_COMPONENT_PATH) {
          try {
            const params = new URL(url, 'http://editor.local').searchParams;
            const file = params.get('file');
            const index = Number(params.get('index'));
            if (!file || !Number.isInteger(index)) {
              sendJson(res, 400, editorApiError('Static editor component requires file and index.'));
              return;
            }
            res.setHeader('content-type', 'text/javascript; charset=utf-8');
            res.setHeader('cache-control', 'no-store');
            res.end(await buildStaticEditorComponent(file, index));
          } catch (err) {
            sendJson(res, 500, editorApiError((err as Error).message));
          }
          return;
        }

        if (pathname === '/__editor/ping') {
          res.setHeader('content-type', 'text/plain');
          res.end(`pong ${Date.now()} wsToken=${wsToken} transformCalls=${transformCalls}`);
          return;
        }

        if (pathname === EDITOR_PUBLIC_FILES_PATH) {
          if (req.method === 'GET') {
            const publicDir = editorPublicDir(server, root);
            if (!publicDir) {
              sendJson(res, 400, editorApiError('Vite publicDir is disabled.'));
              return;
            }
            sendJson(res, 200, { files: listPublicFiles(publicDir) } satisfies ListPublicFilesResponse);
            return;
          }

          if (req.method !== 'POST') {
            sendJson(res, 405, editorApiError('Public file requests require GET or POST.'));
            return;
          }

          try {
            const publicDir = editorPublicDir(server, root);
            if (!publicDir) {
              sendJson(res, 400, editorApiError('Vite publicDir is disabled.'));
              return;
            }

            const upload = parseMultipartUpload(req, await readRequestBuffer(req));
            mkdirSync(publicDir, { recursive: true });
            const fileName = publicUploadFileName(upload.fileName, publicDir);
            writeFileSync(resolve(publicDir, fileName), upload.data);
            sendJson(res, 200, {
              ok: true,
              fileName,
              url: `/${encodeURIComponent(fileName)}`,
              contentType: upload.contentType,
            } satisfies UploadPublicFileResponse);
          } catch (err) {
            sendJson(res, 400, editorApiError((err as Error).message));
          }
          return;
        }

        if (pathname.startsWith(`${CONFIGURABLES_PATH}/`) && req.method === 'POST') {
          const id = decodeURIComponent(pathname.slice(CONFIGURABLES_PATH.length + 1));
          const record = configurablesById.get(id);
          if (!record) {
            sendJson(res, 404, { error: 'Unknown configurable id.' });
            return;
          }

          try {
            const replacement = parseReplacementBody(req, await readRequestBody(req));
            const current = readFileSync(record.file, 'utf8');
            const currentSource = current.slice(record.start, record.end);
            if (currentSource !== record.source) {
              sendJson(res, 409, {
                error: 'Configurable source range is stale. Reload the module and retry.',
                expected: record.source,
                actual: currentSource,
              });
              return;
            }

            const next = `${current.slice(0, record.start)}${replacement}${current.slice(record.end)}`;
            writeFileSync(record.file, next);
            const refreshed = collectConfigurables(next, record.file, root);
            replaceFileConfigurables(record.file, refreshed?.records ?? []);
            const updatedRecord = configurablesById.get(record.id) ?? {
              ...record,
              source: replacement,
              value: JSON.parse(replacement) as unknown,
              end: record.start + replacement.length,
            };
            sendJson(res, 200, {
              ...publicConfigurable(updatedRecord),
              ok: true,
            });
          } catch (err) {
            sendJson(res, 400, { error: (err as Error).message });
          }
          return;
        }

        if (pathname === EDITOR_PATH || pathname === `${EDITOR_PATH}/`) {
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.end(renderEditorShell());
          return;
        }
        next();
      });

      log.info(`[editor] active at ${EDITOR_PATH}`);
    },
  };
}

export { editorPlugin };

export declare const array: typeof import('./default-schemas').array;
export declare const boolean: typeof import('./default-schemas').boolean;
export declare const color: typeof import('./default-schemas').color;
export declare const config: typeof import('./configurable').config;
export declare const configurable: typeof import('./configurable').configurable;
export declare const defineField: typeof import('./configurable').defineField;
export declare const euler: typeof import('./default-schemas').euler;
export declare const fileUrl: typeof import('./default-schemas').fileUrl;
export declare const json: typeof import('./default-schemas').json;
export declare const number: typeof import('./default-schemas').number;
export declare const object: typeof import('./default-schemas').object;
export declare const optional: typeof import('./default-schemas').optional;
export declare const position3D: typeof import('./default-schemas').position3D;
export declare const rotation3D: typeof import('./default-schemas').rotation3D;
export declare const scale3D: typeof import('./default-schemas').scale3D;
export declare const schema: typeof import('./default-schemas').schema;
export declare const string: typeof import('./default-schemas').string;
export declare const transform3D: typeof import('./default-schemas').transform3D;
export declare const val: typeof import('./configurable').val;
export declare const vec2: typeof import('./default-schemas').vec2;
export declare const vec3: typeof import('./default-schemas').vec3;

export type {
  DefineFieldOptions,
  EditorComponentRef,
  EditorFieldComponent,
  EditorFieldComponentProps,
  Field,
  FieldDescriptor,
  FieldOptions,
  FieldTemplate,
  FieldValue,
  JsonValue,
  Vector2,
  Vector3,
} from './configurable';
export type {
  ArrayFieldOptions,
  BooleanFieldOptions,
  ColorFieldOptions,
  FileUrlFieldOptions,
  NumberFieldOptions,
  ObjectFieldOptions,
  OptionalFieldOptions,
  StringFieldOptions,
  Transform3D,
  Transform3DFieldOptions,
  VectorFieldOptions,
} from './default-schemas';
