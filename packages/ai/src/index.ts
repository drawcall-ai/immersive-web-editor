import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EditorPlugin } from 'immersive-web-editor';

export interface AiChatPluginOptions {
  enabled?: boolean;
  port?: number;
  host?: string;
  cwd?: string;
  autoStart?: boolean;
  command?: string;
  env?: Record<string, string>;
}

type AiStatus =
  | { state: 'disabled'; message?: string }
  | { state: 'starting'; message?: string }
  | { state: 'ready'; message?: string }
  | { state: 'error'; message: string };

const OC_PROXY_PREFIX = '/__editor/oc';
const AI_STATUS_PATH = '/__editor/ai/status';
const DEFAULT_PORT = 4096;

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const STRIPPED_DOWNSTREAM = new Set([...HOP_BY_HOP, 'content-length', 'content-encoding']);

const entryFile = fileURLToPath(import.meta.url);
const here = dirname(entryFile);
const clientEntry = resolve(here, 'client', entryFile.endsWith('.ts') ? 'register.tsx' : 'register.js');

class OpencodeBackend {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private status: AiStatus;
  private options: Required<Omit<AiChatPluginOptions, 'command' | 'env'>> & {
    command: string;
    env: Record<string, string>;
  };

  constructor(options: Required<Omit<AiChatPluginOptions, 'command' | 'env'>> & {
    command: string;
    env: Record<string, string>;
  }) {
    this.options = options;
    this.status = options.enabled ? { state: 'starting', message: 'OpenCode has not been requested yet.' } : { state: 'disabled' };
  }

  get url(): string {
    return `http://${this.options.host}:${this.options.port}`;
  }

  getStatus(): AiStatus {
    return this.status;
  }

  async ensureStarted(): Promise<void> {
    if (!this.options.enabled) throw new Error('AI chat is disabled.');
    if (await this.isReady()) {
      this.status = { state: 'ready' };
      return;
    }
    if (!this.options.autoStart) {
      this.status = { state: 'error', message: `OpenCode is not running at ${this.url}.` };
      throw new Error(this.status.message);
    }
    if (!this.startPromise) {
      this.status = { state: 'starting', message: 'Starting OpenCode...' };
      this.startPromise = this.start().finally(() => {
        this.startPromise = null;
      });
    }
    await this.startPromise;
  }

  close(): void {
    if (!this.proc || this.proc.killed) return;
    this.proc.kill('SIGTERM');
    this.proc = null;
  }

  private async start(): Promise<void> {
    this.proc = spawn(
      this.options.command,
      ['serve', '--port', String(this.options.port), '--hostname', this.options.host],
      {
        cwd: this.options.cwd,
        env: { ...process.env, ...this.options.env },
      },
    );

    let stderr = '';
    this.proc.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    this.proc.once('exit', (code, signal) => {
      if (this.status.state !== 'ready') {
        this.status = {
          state: 'error',
          message: `OpenCode exited before it became ready (${signal ?? code ?? 'unknown'}). ${stderr}`.trim(),
        };
      }
    });

    try {
      await this.waitForReady();
      this.status = { state: 'ready' };
    } catch (err) {
      this.status = {
        state: 'error',
        message: `${(err as Error).message}${stderr ? `\n${stderr}` : ''}`,
      };
      throw err;
    }
  }

  private async waitForReady(): Promise<void> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (await this.isReady()) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for OpenCode at ${this.url}.`);
  }

  private async isReady(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/path`);
      return res.ok;
    } catch {
      return false;
    }
  }
}

function resolveOpencodeCommand(root: string, command?: string): string {
  if (command) return command;
  const bin = process.platform === 'win32' ? 'opencode.cmd' : 'opencode';
  const candidates = [
    resolve(root, 'node_modules', '.bin', bin),
    resolve(process.cwd(), 'node_modules', '.bin', bin),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? bin;
}

function findEnvFiles(start: string): string[] {
  const files: string[] = [];
  let dir = resolve(start);
  const root = parse(dir).root;
  while (true) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) files.unshift(candidate);
    if (dir === root) break;
    dir = dirname(dir);
  }
  return files;
}

function parseEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  const src = readFileSync(path, 'utf8');
  for (const rawLine of src.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    env[key] = value;
  }
  return env;
}

function loadEnv(start: string): Record<string, string> {
  return Object.assign({}, ...findEnvFiles(start).map(parseEnvFile));
}

function definedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function buildOpencodeEnv(
  root: string,
  options: AiChatPluginOptions,
): Record<string, string> {
  const fromDotenv = loadEnv(root);
  const env = {
    ...fromDotenv,
    ...definedEnv(process.env),
    ...(options.env ?? {}),
  };

  const openrouterKey = env.OPENROUTER_API_KEY || env.OPENROUTER_KEY;
  if (openrouterKey) {
    env.OPENROUTER_API_KEY = openrouterKey;
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      provider: {
        openrouter: {
          options: { apiKey: openrouterKey },
        },
      },
    });
  }

  return env;
}

async function proxyToOpencode(
  req: IncomingMessage,
  res: ServerResponse,
  backend: OpencodeBackend,
): Promise<void> {
  await backend.ensureStarted();

  const rawUrl = req.url ?? '';
  const targetPath = rawUrl.slice(OC_PROXY_PREFIX.length) || '/';
  const target = `${backend.url}${targetPath}`;

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    const lower = k.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === 'host') continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }

  let body: ArrayBuffer | undefined;
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const joined = Buffer.concat(chunks);
    body = joined.buffer.slice(joined.byteOffset, joined.byteOffset + joined.byteLength) as ArrayBuffer;
  }

  const upstream = await fetch(target, { method: req.method, headers, body });
  const contentType = upstream.headers.get('content-type') ?? '';
  const isSse = contentType.includes('text/event-stream');

  res.statusCode = upstream.status;
  upstream.headers.forEach((value, key) => {
    if (STRIPPED_DOWNSTREAM.has(key.toLowerCase())) return;
    res.setHeader(key, value);
  });

  if (!upstream.body) {
    res.end();
    return;
  }

  if (!isSse) {
    const buf = new Uint8Array(await upstream.arrayBuffer());
    if (!res.writableEnded) res.end(buf);
    return;
  }

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || res.writableEnded) break;
      res.write(value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
    if (!res.writableEnded) res.end();
  }
}

export function ai(options: AiChatPluginOptions = {}): EditorPlugin {
  return {
    name: 'ai-chat',
    client: clientEntry,
    commands: [
      {
        id: 'editor.chat.focus',
        title: 'Chat: focus',
        scope: 'editor:chat:session',
      },
    ],
    configureServer({ server }) {
      const cwd = options.cwd ?? server.config.root;
      const backend = new OpencodeBackend({
        enabled: options.enabled ?? true,
        port: options.port ?? DEFAULT_PORT,
        host: options.host ?? '127.0.0.1',
        cwd,
        autoStart: options.autoStart ?? true,
        command: resolveOpencodeCommand(server.config.root, options.command),
        env: buildOpencodeEnv(cwd, options),
      });

      const cleanup = () => backend.close();
      server.httpServer?.once('close', cleanup);
      process.once('exit', cleanup);
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (url === AI_STATUS_PATH) {
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(backend.getStatus()));
          return;
        }
        if (!url.startsWith(OC_PROXY_PREFIX)) {
          next();
          return;
        }
        try {
          await proxyToOpencode(req, res, backend);
        } catch (err) {
          if (!res.writableEnded) {
            res.statusCode = 502;
            res.end(`opencode proxy error: ${(err as Error).message}`);
          }
        }
      });
    },
  };
}

export default ai;
