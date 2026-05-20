import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import pc from 'picocolors';
import type { Plugin, ViteDevServer } from 'vite';
import type { EditorApiErrorResponse, ListPublicFilesResponse, PublicFile, UploadPublicFileResponse } from '../rpc.js';
import {
  DEFAULT_CONFIG_PATH,
  DEFAULT_OVERLAY_PATH,
  DEFAULT_PREVIEW_PATH,
  type EditorFolderPath,
  type EditorOptions,
  type EditorPlugin,
  type EditorSlotPath,
} from './options.js';

const EDITOR_PATH = '/editor';
const CONFIGURABLES_PATH = '/__editor/configurables';
const EDITOR_PUBLIC_FILES_PATH: typeof import('../rpc.js').EDITOR_PUBLIC_FILES_PATH = '/__editor/public-files';
const EDITOR_SHELL_VIRTUAL_ID = 'virtual:editor/shell';
const EDITOR_CONFIG_VIRTUAL_ID = 'virtual:editor/config';
const EDITOR_PLUGIN_VIRTUAL_PREFIX = 'virtual:editor/plugin/';
const CONFIGURABLE_MODULE_ID = 'immersive-web-editor';
const EDITOR_COMPONENT_QUERY = 'editor-component';
const REACT_DEDUPE = ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'];

const entryFile = fileURLToPath(import.meta.url);
const here = dirname(entryFile);
const runtimeDir = resolve(here, '..');
const packageSourceDir = existsSync(resolve(runtimeDir, '..', 'src'))
  ? resolve(runtimeDir, '..', 'src')
  : runtimeDir;
const require = createRequire(import.meta.url);
const REACT_ALIASES = [
  { find: /^react$/, replacement: require.resolve('react') },
  { find: /^react\/jsx-runtime$/, replacement: require.resolve('react/jsx-runtime') },
  { find: /^react\/jsx-dev-runtime$/, replacement: require.resolve('react/jsx-dev-runtime') },
  { find: /^react-dom$/, replacement: require.resolve('react-dom') },
  { find: /^react-dom\/client$/, replacement: require.resolve('react-dom/client') },
];
const appEntry = resolve(packageSourceDir, 'app', entryFile.endsWith('.ts') || packageSourceDir.endsWith(`${sep}src`) ? 'index.ts' : 'index.js');
const editorEntry = resolve(packageSourceDir, 'editor', entryFile.endsWith('.ts') || packageSourceDir.endsWith(`${sep}src`) ? 'index.tsx' : 'index.js');
const uiSrcDir = resolve(packageSourceDir, '../../ui/src');
const adapterSrcDir = resolve(packageSourceDir, '../../adapter/src');

function fsModulePath(file: string): string {
  return `/@fs/${normalizePath(resolve(file))}`;
}

function clientModulePath(client: string): string {
  return isBareModuleId(client) ? client : fsModulePath(client);
}

function isBareModuleId(value: string): boolean {
  return !value.startsWith('/') && !value.startsWith('.') && !/^[A-Za-z]:[\\/]/.test(value);
}

interface ConfigurableRecord {
  id: string;
  modulePath: string;
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

function isWithin(file: string, directory: string): boolean {
  const relativePath = relative(directory, file);
  return relativePath !== '' && !relativePath.startsWith('..') && !relativePath.startsWith(`${sep}`);
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
  components: Set<string>;
  values: Set<string>;
} {
  const configs = new Set<string>();
  const components = new Set<string>();
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
      if (imported === 'editorComponent') components.add(local);
      if (imported === 'val') values.add(local);
    }
  }

  return { configs, components, values };
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

function skipWhitespaceInRange(code: string, index: number, end: number): number {
  let cursor = index;
  while (cursor < end && /\s/.test(code[cursor] ?? '')) cursor++;
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
  if (!callEnd || skipWhitespaceInRange(code, callEnd.close + 1, range.end) !== range.end) return null;

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
  if (close === -1 || skipWhitespaceInRange(code, close + 1, range.end) !== range.end) return [];

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

function viteModulePath(file: string, root: string): string {
  const relativeFile = normalizePath(relative(root, file));
  return relativeFile && !relativeFile.startsWith('../') && relativeFile !== '..'
    ? `/${relativeFile}`
    : fsModulePath(file);
}

function collectConfigurables(
  code: string,
  file: string,
  root: string,
  aliases = importedAliases(code),
): { code: string; records: ConfigurableRecord[] } | null {
  const calls = findConfigurableCalls(code, aliases);
  if (calls.length === 0) return null;

  const relativeFile = normalizePath(relative(root, file));
  const modulePath = viteModulePath(file, root);
  const records: ConfigurableRecord[] = [];
  let transformed = code;

  for (const call of [...calls].reverse()) {
    const { line, column } = positionAt(code, call.valueStart);
    const id = configurableId(relativeFile, line, column);
    records.unshift({
      id,
      modulePath,
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
    transformed = `${transformed.slice(0, call.openParen + 1)}${JSON.stringify({ id, modulePath, panel: call.panel, path: call.path })}, ${transformed.slice(call.openParen + 1)}`;
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
    modulePath: record.modulePath,
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

function editorComponentUrl(file: string, index: number, source: string): string {
  const params = new URLSearchParams({ [EDITOR_COMPONENT_QUERY]: String(index), v: sourceHash(source) });
  return `${fsModulePath(file)}?${params.toString()}`;
}

function sourceHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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
      module: editorComponentUrl(file, index, match.source),
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

function resolveEditorComponentModule(file: string, moduleId: string): string {
  if (isBareModuleId(moduleId)) return moduleId;
  return fsModulePath(moduleId.startsWith('/') ? moduleId : resolve(dirname(file), moduleId));
}

function replaceEditorComponentRefs(code: string, file: string, aliases: ReturnType<typeof importedAliases>): string {
  if (aliases.components.size === 0) return code;

  let transformed = code;
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const state: ScanState = { quote: null, lineComment: false, blockComment: false, escaped: false, templateDepth: 0 };

  for (let index = 0; index < code.length; index++) {
    advanceScanState(code, index, state);
    if (state.quote || state.lineComment || state.blockComment) continue;
    if (isIdentifierChar(code[index - 1])) continue;

    for (const alias of aliases.components) {
      if (!code.startsWith(alias, index) || isIdentifierChar(code[index + alias.length])) continue;
      const openParen = skipWhitespace(code, index + alias.length);
      if (code[openParen] !== '(') continue;
      const end = findCallEnd(code, openParen);
      if (!end) continue;
      const args = splitTopLevelArgs(code, openParen, end.close);
      const moduleArg = args[0];
      if (!moduleArg) continue;
      const moduleId = parseStringLiteralSource(code, moduleArg, 'editorComponent(...) module');
      const exportName = args[1]
        ? parseStringLiteralSource(code, args[1], 'editorComponent(...) export name')
        : 'default';
      replacements.push({
        start: index,
        end: end.close + 1,
        value: JSON.stringify({
          module: resolveEditorComponentModule(file, moduleId),
          exportName,
        }),
      });
      index = end.close;
      break;
    }
  }

  for (const replacement of replacements.reverse()) {
    transformed = `${transformed.slice(0, replacement.start)}${replacement.value}${transformed.slice(replacement.end)}`;
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
    <script type="module" src="/@vite/client"></script>
    <script type="module" src="/@id/__x00__${EDITOR_SHELL_VIRTUAL_ID}"></script>
  </head>
  <body></body>
</html>
`;
}

function renderEditorConfigModule(
  plugins: EditorPlugin[],
  previewUrl: string | undefined,
  previewPath: EditorSlotPath,
  overlayPath: EditorSlotPath,
  configPath: EditorFolderPath,
): string {
  const pluginModules = plugins
    .filter((plugin) => plugin.client)
    .map((plugin, index) => ({
      name: plugin.name,
      importName: `plugin${index}`,
      module: `${EDITOR_PLUGIN_VIRTUAL_PREFIX}${index}`,
      path: plugin.path,
    }));
  const pluginCommands = plugins.flatMap((plugin) => plugin.commands ?? []);

  return `${pluginModules.map((plugin) => `import * as ${plugin.importName} from ${JSON.stringify(plugin.module)};`).join('\n')}

export const previewUrl = ${JSON.stringify(previewUrl)};
export const previewPath = ${JSON.stringify(previewPath)};
export const overlayPath = ${JSON.stringify(overlayPath)};
export const configPath = ${JSON.stringify(configPath)};
export const pluginModules = [
${pluginModules.map((plugin) => `  { name: ${JSON.stringify(plugin.name)}, path: ${JSON.stringify(plugin.path)}, module: ${plugin.importName} },`).join('\n')}
];
export const pluginCommands = ${JSON.stringify(pluginCommands)};
`;
}

function editorUrl(baseUrl: string): string {
  return new URL(EDITOR_PATH, baseUrl).href;
}

function colorUrl(url: string): string {
  return pc.cyan(url.replace(/:(\d+)\//, (_, port: string) => `:${pc.bold(port)}/`));
}

function printEditorUrls(server: ViteDevServer): void {
  const urls = server.resolvedUrls;
  if (!urls) return;
  const log = server.config.logger;
  for (const url of urls.local) log.info(`  ${pc.green('➜')}  ${pc.bold('Editor')}:  ${colorUrl(editorUrl(url))}`);
  for (const url of urls.network) log.info(`  ${pc.green('➜')}  ${pc.bold('Editor')}:  ${colorUrl(editorUrl(url))}`);
}

function shouldReloadEditor(file: string): boolean {
  return isWithin(file, resolve(packageSourceDir, 'client'))
    || isWithin(file, resolve(packageSourceDir, 'editor'))
    || file === resolve(packageSourceDir, 'default-schema-components.tsx')
    || file === resolve(packageSourceDir, 'default-schemas.tsx')
    || file === resolve(packageSourceDir, 'editor-components.ts')
    || file === resolve(packageSourceDir, 'rpc.ts')
    || isWithin(file, uiSrcDir)
    || isWithin(file, adapterSrcDir);
}

export default function editorPlugin(options: EditorOptions = {}): Plugin {
  const plugins = options.plugins ?? [];
  const clientPlugins = plugins.filter((plugin) => plugin.client);
  const previewPath = options.previewPath ?? DEFAULT_PREVIEW_PATH;
  const overlayPath = options.overlayPath ?? DEFAULT_OVERLAY_PATH;
  const configPath = options.configPath ?? DEFAULT_CONFIG_PATH;
  const configurablesByFile = new Map<string, ConfigurableRecord[]>();
  const configurablesById = new Map<string, ConfigurableRecord>();
  let wsToken = '';
  let transformCalls = 0;
  let root = process.cwd();
  let previewUrl = options.build?.previewUrl;
  let printedEditorUrls = false;

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

  function printEditorUrlsOnce(server: ViteDevServer): void {
    if (printedEditorUrls) return;
    const urls = server.resolvedUrls;
    if (!urls) return;
    printedEditorUrls = true;
    printEditorUrls(server);
  }

  return {
    name: 'immersive-web-editor',
    apply() {
      return true;
    },
    enforce: 'pre',

    config(_config, env) {
      const sharedConfig = {
        resolve: {
          alias: [
            ...REACT_ALIASES,
            { find: new RegExp(`^${escapeRegExp(CONFIGURABLE_MODULE_ID)}$`), replacement: appEntry },
          ],
          dedupe: REACT_DEDUPE,
        },
      };
      if (env.command !== 'build' || options.build?.enabled !== true) return sharedConfig;
      previewUrl = options.build.previewUrl;
      return {
        ...sharedConfig,
        build: {
          rollupOptions: {
            input: {
              index: resolve(packageSourceDir, 'editor/index.html'),
            },
          },
        },
      };
    },

    configResolved(config) {
      root = config.root;
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

      const aliases = importedAliases(code);
      const componentCode = replaceEditorComponentRefs(code, file, aliases);
      const result = collectConfigurables(componentCode, file, root, aliases);
      const nextCode = extractEditorComponents(result?.code ?? componentCode, file);

      replaceFileConfigurables(file, result?.records ?? []);
      if (!result && nextCode === code) return null;

      return { code: nextCode, map: null };
    },

    resolveId(id) {
      if (id === EDITOR_SHELL_VIRTUAL_ID) return `\0${EDITOR_SHELL_VIRTUAL_ID}`;
      if (id === EDITOR_CONFIG_VIRTUAL_ID) return `\0${EDITOR_CONFIG_VIRTUAL_ID}`;
      if (id.startsWith(EDITOR_PLUGIN_VIRTUAL_PREFIX)) return `\0${id}`;
      return null;
    },

    load(id) {
      if (id === `\0${EDITOR_SHELL_VIRTUAL_ID}`) return `import ${JSON.stringify(fsModulePath(editorEntry))};`;
      if (id === `\0${EDITOR_CONFIG_VIRTUAL_ID}`) {
        return renderEditorConfigModule(plugins, previewUrl, previewPath, overlayPath, configPath);
      }
      if (id.startsWith(`\0${EDITOR_PLUGIN_VIRTUAL_PREFIX}`)) {
        const index = Number(id.slice(`\0${EDITOR_PLUGIN_VIRTUAL_PREFIX}`.length));
        const plugin = clientPlugins[index];
        if (!plugin?.client) return null;
        return `export * from ${JSON.stringify(clientModulePath(plugin.client))};`;
      }
      return null;
    },

    handleHotUpdate(ctx) {
      const file = stripQuery(ctx.file);
      if (!shouldReloadEditor(file)) return;
      ctx.server.ws.send({ type: 'full-reload' });
      return [];
    },

    async configureServer(server) {
      const printViteUrls = server.printUrls.bind(server);
      server.printUrls = () => {
        printViteUrls();
        printEditorUrlsOnce(server);
      };

      server.watcher.add([
        packageSourceDir,
        uiSrcDir,
        adapterSrcDir,
      ]);

      for (const plugin of plugins) {
        await plugin.configureServer?.({ server });
      }

      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        const pathname = new URL(url, 'http://editor.local').pathname;

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

      server.httpServer?.once('listening', () => {
        setTimeout(() => printEditorUrlsOnce(server), 0);
      });
    },
  };
}

export { editorPlugin };
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
} from './options.js';
