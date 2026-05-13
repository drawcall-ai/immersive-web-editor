import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';

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

export interface EditorOptions {
  plugins?: EditorPlugin[];
}

const EDITOR_PATH = '/editor';
const CONFIGURABLES_PATH = '/__editor/configurables';
const EDITOR_SHELL_VIRTUAL_ID = 'virtual:editor/shell';
const CONFIGURABLE_MODULE_ID = '@iwe/vite-plugin/configurable';
const EDITOR_COMPONENT_QUERY = 'editor-component';

const here = dirname(fileURLToPath(import.meta.url));
const editorShellEntry = resolve(here, 'client', 'editor-shell.tsx');

function fsModulePath(file: string): string {
  return `/@fs/${normalizePath(resolve(file))}`;
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
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
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
  return `/@fs/${normalizePath(file)}?${EDITOR_COMPONENT_QUERY}=${index}`;
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

  for (let index = matches.length - 1; index >= 0; index--) {
    const match = matches[index]!;
    const name = `__editor_component_${index}`;
    declarations.unshift(`const ${name} = ${match.source};`);
    transformed = `${transformed.slice(0, match.start)}${JSON.stringify({
      module: editorComponentUrl(file, index),
      exportName: name,
    })}${transformed.slice(match.end)}`;
  }

  const insertAt = findImportInsertionIndex(transformed);
  transformed = `${transformed.slice(0, insertAt)}\n${declarations.join('\n')}\n${transformed.slice(insertAt)}`;

  if (options.exportIndex !== undefined) {
    const name = `__editor_component_${options.exportIndex}`;
    transformed += `\nexport { ${name} };\n`;
  }

  return transformed;
}

function renderEditorShell(wsToken: string, plugins: EditorPlugin[]): string {
  const pluginModules = plugins
    .filter((plugin) => plugin.client)
    .map((plugin) => ({
      name: plugin.name,
      module: fsModulePath(plugin.client!),
    }));
  const pluginCommands = plugins.flatMap((plugin) => plugin.commands ?? []);

  // Skeleton HTML for /editor. Plugin middleware serves this with the wsToken
  // templated in so @vite/client can open the HMR WS. No transformIndexHtml
  // pass — /editor is served directly, not through Vite's module graph.
  const config = {
    wsToken,
    pluginModules,
    pluginCommands,
  };
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Editor</title>
    <script id="__editor_config__" type="application/json">${JSON.stringify(config).replace(/</g, '\\u003c')}</script>
    <script type="module">
      try {
        const RefreshRuntime = (await import('/@react-refresh')).default;
        RefreshRuntime.injectIntoGlobalHook(window);
      } catch {
        // Non-React apps do not expose /@react-refresh. The no-op globals keep
        // modules transformed by @vitejs/plugin-react happy.
      }
      window.$RefreshReg$ = window.$RefreshReg$ || (() => {});
      window.$RefreshSig$ = window.$RefreshSig$ || (() => (type) => type);
      window.__vite_plugin_react_preamble_installed__ = true;
    </script>
    <script type="module" src="/@id/__x00__${EDITOR_SHELL_VIRTUAL_ID}"></script>
  </head>
  <body></body>
</html>
`;
}

export default function editorPlugin(options: EditorOptions = {}): Plugin {
  const plugins = options.plugins ?? [];
  const configurablesByFile = new Map<string, ConfigurableRecord[]>();
  const configurablesById = new Map<string, ConfigurableRecord>();
  let wsToken = '';
  let transformCalls = 0;
  let root = process.cwd();

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

  return {
    name: '@iwe/vite-plugin',
    apply: 'serve',
    enforce: 'pre',

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

      const result = collectConfigurables(code, file, root);
      const nextCode = extractEditorComponents(result?.code ?? code, file);

      replaceFileConfigurables(file, result?.records ?? []);
      if (!result && nextCode === code) return null;

      return { code: nextCode, map: null };
    },

    resolveId(id) {
      if (id === EDITOR_SHELL_VIRTUAL_ID) return `\0${EDITOR_SHELL_VIRTUAL_ID}`;
      return null;
    },

    load(id) {
      if (id === `\0${EDITOR_SHELL_VIRTUAL_ID}`) return `import ${JSON.stringify(fsModulePath(editorShellEntry))};`;
      return null;
    },

    async configureServer(server) {
      const log = server.config.logger;
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
          res.end(renderEditorShell(wsToken, plugins));
          return;
        }
        next();
      });

      log.info(`[editor] active at ${EDITOR_PATH}`);
    },
  };
}

export { editorPlugin };
