import { expect, type Page, type TestInfo } from '@playwright/test';
import { createReadStream, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import net from 'node:net';
import { dirname, extname, resolve } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { EditorHarness } from './shared/editor-behavior';
import { expectEditorReady } from './shared/editor-behavior';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = resolve(repoRoot, 'e2e/fixtures/vite-app');
const appFile = resolve(appRoot, 'src/main.ts');
const appBaselineFile = resolve(appRoot, 'main.baseline.ts');
const appPublicDir = resolve(appRoot, 'public');
const reactThreeStartExampleRoot = resolve(repoRoot, 'examples/react-three-start');
const reactThreeStartHudFile = resolve(reactThreeStartExampleRoot, 'src/hud.dom.tsx');
const reactThreeStartHudBaseline = readFileSync(reactThreeStartHudFile, 'utf8');
const staticEditorRoot = resolve(repoRoot, 'packages/editor/src/editor');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const originalAppSource = readFileSync(appBaselineFile, 'utf8');
const originalPublicFiles = new Set(readdirSync(appPublicDir));
const staticEditorOutDirs: string[] = [];

type StartedApp = { origin: string; stop(): Promise<void> };
type StartedEditor = { origin: string; stop(): Promise<void> };

export type LocalEditorMode = 'live preview' | 'built';

export function createFixtureFieldHarness(mode: LocalEditorMode): EditorHarness {
  let app: StartedApp | undefined;
  let editor: StartedEditor | undefined;

  return {
    name: mode,
    async setup() {
      resetAppFixture();
      await resetPublicFiles();
      app = await startViteApp();
      editor = mode === 'built'
        ? await startBuiltEditor(app.origin)
        : { origin: app.origin, stop: async () => undefined };
    },
    async teardown() {
      await editor?.stop();
      await app?.stop();
      editor = undefined;
      app = undefined;
      resetAppFixture();
      await resetPublicFiles();
    },
    async openEditor(page) {
      await page.goto(`${editor!.origin}/editor`);
      await expectEditorReady(page, expect);
    },
    async createUploadFile(testInfo: TestInfo, name: string, content: string) {
      const uploadPath = resolve(testInfo.outputDir, name);
      await mkdir(testInfo.outputDir, { recursive: true });
      writeFileSync(uploadPath, content);
      return uploadPath;
    },
  };
}

export function createReactThreeStartHarness(mode: LocalEditorMode): EditorHarness {
  let app: StartedApp | undefined;
  let editor: StartedEditor | undefined;

  return {
    name: mode,
    async setup() {
      resetReactThreeStartFixture();
      app = await startReactThreeStartExample();
      editor = mode === 'built'
        ? await startBuiltEditor(app.origin)
        : { origin: app.origin, stop: async () => undefined };
    },
    async teardown() {
      await editor?.stop();
      await app?.stop();
      editor = undefined;
      app = undefined;
      resetReactThreeStartFixture();
    },
    async openEditor(page: Page) {
      await page.goto(`${editor!.origin}/editor`);
      await expectEditorReady(page, expect);
    },
  };
}

export async function cleanupStaticEditorOutDirs(): Promise<void> {
  await Promise.all(staticEditorOutDirs.map((dir) => rm(dir, { recursive: true, force: true })));
}

function resetAppFixture(): void {
  writeFileSync(appFile, originalAppSource);
}

function resetReactThreeStartFixture(): void {
  writeFileSync(reactThreeStartHudFile, reactThreeStartHudBaseline);
}

async function resetPublicFiles(): Promise<void> {
  await mkdir(appPublicDir, { recursive: true });
  for (const entry of readdirSync(appPublicDir)) {
    if (!originalPublicFiles.has(entry)) {
      await rm(resolve(appPublicDir, entry), { recursive: true, force: true });
    }
  }
}

async function startViteApp(): Promise<StartedApp> {
  const port = await getFreePort();
  const child = spawnProcess(pnpm, ['exec', 'vite', '--config', resolve(appRoot, 'vite.config.ts'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], appRoot);
  const origin = `http://127.0.0.1:${port}`;
  await waitForHttp(origin, child);
  return {
    origin,
    stop: () => stopProcess(child),
  };
}

async function startReactThreeStartExample(): Promise<StartedApp> {
  const port = await getFreePort();
  const child = spawnProcess(pnpm, ['exec', 'react-three-start', 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--force'], reactThreeStartExampleRoot);
  const origin = `http://127.0.0.1:${port}`;
  await waitForHttp(origin, child);
  return {
    origin,
    stop: () => stopProcess(child),
  };
}

async function startBuiltEditor(previewUrl: string): Promise<StartedEditor> {
  const outDir = await buildStaticEditor(previewUrl);
  return startStaticEditorHost(outDir, new URL(previewUrl));
}

async function buildStaticEditor(previewUrl: string): Promise<string> {
  const outDir = resolve(staticEditorRoot, `.e2e-editor-dist-${process.pid}-${Date.now()}-${staticEditorOutDirs.length}`);
  staticEditorOutDirs.push(outDir);
  await mkdir(outDir, { recursive: true });
  await runCommand(
    pnpm,
    ['exec', 'vite', 'build', '--config', resolve(repoRoot, 'e2e/editor-static.vite.config.ts'), '--outDir', outDir, '--emptyOutDir'],
    repoRoot,
    { E2E_PREVIEW_URL: previewUrl },
  );
  return outDir;
}

async function startStaticEditorHost(staticDir: string, appOrigin: URL): Promise<StartedEditor> {
  const port = await getFreePort();
  const sockets = new Set<net.Socket>();
  const server = createServer((req, res) => {
    handleStaticOrApiRequest(staticDir, appOrigin, req, res);
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await listen(server, port);
  return {
    origin: `http://127.0.0.1:${port}`,
    async stop() {
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections?.();
      await closeServer(server);
    },
  };
}

function handleStaticOrApiRequest(
  staticDir: string,
  appOrigin: URL,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/editor' || pathname === '/editor/') {
    serveFile(resolve(staticDir, 'index.html'), 'text/html; charset=utf-8', res);
    return;
  }

  if (pathname.startsWith('/assets/')) {
    const file = resolve(staticDir, `.${pathname}`);
    if (file.startsWith(staticDir) && existsSync(file)) {
      serveFile(file, contentType(file), res);
      return;
    }
  }

  proxyHttp(appOrigin, req, res);
}

function serveFile(file: string, type: string, res: ServerResponse): void {
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}

function proxyHttp(appOrigin: URL, req: IncomingMessage, res: ServerResponse): void {
  const upstream = httpRequest({
    hostname: appOrigin.hostname,
    port: appOrigin.port,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: appOrigin.host,
    },
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });

  upstream.on('error', (err) => {
    if (res.destroyed) return;
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(err));
  });
  req.pipe(upstream);
}

function contentType(file: string): string {
  if (extname(file) === '.js') return 'text/javascript; charset=utf-8';
  if (extname(file) === '.css') return 'text/css; charset=utf-8';
  if (extname(file) === '.html') return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<void> {
  const child = spawnProcess(command, args, cwd, env);
  const result = await waitForExit(child);
  if (result.code !== 0) {
    throw new Error(`Command failed (${result.code}): ${command} ${args.join(' ')}\n${result.output}`);
  }
}

function spawnProcess(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): ChildProcessWithoutNullStreams {
  return spawn(command, args, {
    cwd,
    env: { ...process.env, ...env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForHttp(url: string, child: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + 30_000;
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before becoming ready (${child.exitCode}).\n${output}`);
    }
    if (await pingHttp(url)) return;
    await delay(150);
  }

  throw new Error(`Timed out waiting for ${url}.\n${output}`);
}

function pingHttp(url: string): Promise<boolean> {
  const target = new URL(url);
  return new Promise((resolvePing) => {
    const req = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'GET',
    }, (res) => {
      res.resume();
      resolvePing((res.statusCode ?? 500) < 500);
    });
    req.setTimeout(1_000, () => {
      req.destroy();
      resolvePing(false);
    });
    req.on('error', () => resolvePing(false));
    req.end();
  });
}

async function waitForExit(child: ChildProcessWithoutNullStreams): Promise<{ code: number | null; output: string }> {
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  return new Promise((resolveExit) => {
    child.on('exit', (code) => resolveExit({ code, output }));
  });
}

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    waitForExit(child),
    delay(5_000).then(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }),
  ]);
}

async function getFreePort(): Promise<number> {
  const server = createServer();
  await listen(server, 0);
  const address = server.address();
  await closeServer(server);
  if (!address || typeof address === 'string') throw new Error('Could not allocate a free port.');
  return address.port;
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolveListen();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((err) => err ? reject(err) : resolveClose());
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
