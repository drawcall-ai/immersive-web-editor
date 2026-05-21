import { expect, test, type Page } from '@playwright/test';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import net from 'node:net';
import { dirname, extname, resolve } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = resolve(repoRoot, 'e2e/fixtures/vite-app');
const appFile = resolve(appRoot, 'src/main.ts');
const aiChatExampleRoot = resolve(repoRoot, 'examples/ai-chat');
const aiChatExampleFile = resolve(aiChatExampleRoot, 'src/App.tsx');
const reactThreeStartExampleRoot = resolve(repoRoot, 'examples/react-three-start');
const staticEditorRoot = resolve(repoRoot, 'packages/editor/src/editor');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

let originalAppSource = '';
let originalAiChatExampleSource = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  originalAppSource = readFileSync(appFile, 'utf8');
  originalAiChatExampleSource = readFileSync(aiChatExampleFile, 'utf8');
});

test.afterEach(() => {
  writeFileSync(appFile, originalAppSource);
  writeFileSync(aiChatExampleFile, originalAiChatExampleSource);
});

test('Vite serves the live editor and live app together', async ({ page }) => {
  const app = await startViteApp();
  try {
    await expectEditorCanEdit(page, `${app.origin}/editor`, `Live editor ${Date.now()}`);
  } finally {
    await app.stop();
  }
});

test('live editor removes stale config fields after client HMR', async ({ page }) => {
  const app = await startAiChatExample();
  try {
    await page.goto(`${app.origin}/editor`);

    const preview = page.frameLocator('iframe[title="Preview"]');
    await expect(preview.getByRole('heading', { name: 'Hello World' })).toBeVisible();

    const oldSlot = page.locator('[data-editor-slot-path="Fields/Scene/title"]');
    const newSlot = page.locator('[data-editor-slot-path="Fields/Scene/name"]');
    await expect(oldSlot).toBeVisible();
    await expect(newSlot).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'calm' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'alert' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'hostile' })).toBeVisible();

    writeFileSync(
      aiChatExampleFile,
      originalAiChatExampleSource
        .replace('title: val("Hello World")', 'name: val("Hello World")')
        .replace('<h1>{scene.title}</h1>', '<h1>{scene.name}</h1>'),
    );

    await expect(newSlot).toBeVisible();
    await expect(oldSlot).toHaveCount(0);
    await expect(preview.getByRole('heading', { name: 'Hello World' })).toBeVisible();
  } finally {
    await app.stop();
  }
});

test('react-three-start example renders the editor without splitting the 3D runtime', async ({ page }) => {
  const app = await startReactThreeStartExample();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  try {
    await page.goto(`${app.origin}/editor`);

    const preview = page.frameLocator('iframe[title="Preview"]');
    await expect(page.getByText('HUD Label')).toBeVisible();
    await expect(preview.locator('canvas')).toHaveCount(1);
    await expect(page.locator('canvas')).toHaveCount(1);

    expect(pageErrors).not.toContainEqual(expect.stringContaining('Hooks can only be used within the Canvas component'));
    expect(consoleErrors).not.toContainEqual(expect.stringContaining('Hooks can only be used within the Canvas component'));
  } finally {
    await app.stop();
  }
});

test('a built editor hosted statically edits a live Vite app', async ({ page }) => {
  const app = await startViteApp();
  const outDirName = `.e2e-editor-dist-${process.pid}-${Date.now()}`;
  const outDir = resolve(staticEditorRoot, outDirName);
  let host: Awaited<ReturnType<typeof startStaticEditorHost>> | undefined;

  try {
    await mkdir(outDir, { recursive: true });
    await runCommand(
      pnpm,
      ['exec', 'vite', 'build', '--config', resolve(repoRoot, 'e2e/editor-static.vite.config.ts'), '--outDir', outDirName, '--emptyOutDir'],
      repoRoot,
      { E2E_PREVIEW_URL: '/' },
    );
    host = await startStaticEditorHost(outDir, new URL(app.origin));

    await expectEditorCanEdit(page, `${host.origin}/editor`, `Static editor ${Date.now()}`);
  } finally {
    await host?.stop();
    await app.stop();
    await rm(outDir, { recursive: true, force: true });
  }
});

async function expectEditorCanEdit(page: Page, editorUrl: string, nextTitle: string): Promise<void> {
  await page.goto(editorUrl);

  const preview = page.frameLocator('iframe[title="Preview"]');
  await expect(preview.getByRole('heading', { name: 'Hello World' })).toBeVisible();

  const titleSlot = page.locator('[data-editor-slot-path="Fields/Scene/title"]');
  await expect(titleSlot).toBeVisible();
  const titleInput = titleSlot.locator('input');
  await expect(titleInput).toHaveValue('Hello World');

  await titleInput.fill(nextTitle);
  await titleInput.press('Enter');

  await expect(titleInput).toHaveValue(nextTitle);
  await expect(preview.getByRole('heading', { name: nextTitle })).toBeVisible();
}

async function startViteApp(): Promise<{ origin: string; stop(): Promise<void> }> {
  const port = await getFreePort();
  const child = spawnProcess(pnpm, ['exec', 'vite', '--config', resolve(appRoot, 'vite.config.ts'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], appRoot);
  const origin = `http://127.0.0.1:${port}`;
  await waitForHttp(origin, child);
  return {
    origin,
    stop: () => stopProcess(child),
  };
}

async function startAiChatExample(): Promise<{ origin: string; stop(): Promise<void> }> {
  const port = await getFreePort();
  const child = spawnProcess(pnpm, ['exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], aiChatExampleRoot);
  const origin = `http://127.0.0.1:${port}`;
  await waitForHttp(origin, child);
  return {
    origin,
    stop: () => stopProcess(child),
  };
}

async function startReactThreeStartExample(): Promise<{ origin: string; stop(): Promise<void> }> {
  const port = await getFreePort();
  const child = spawnProcess(pnpm, ['exec', 'react-three-start', 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--force'], reactThreeStartExampleRoot);
  const origin = `http://127.0.0.1:${port}`;
  await waitForHttp(origin, child);
  return {
    origin,
    stop: () => stopProcess(child),
  };
}

async function startStaticEditorHost(
  staticDir: string,
  appOrigin: URL,
): Promise<{ origin: string; stop(): Promise<void> }> {
  const port = await getFreePort();
  const sockets = new Set<net.Socket>();
  const server = createServer((req, res) => {
    void handleStaticOrProxyRequest(staticDir, appOrigin, req, res);
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  server.on('upgrade', (req, socket, head) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    proxyUpgrade(appOrigin, req, socket, head);
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

async function handleStaticOrProxyRequest(
  staticDir: string,
  appOrigin: URL,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
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
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(err));
  });
  req.pipe(upstream);
}

function proxyUpgrade(appOrigin: URL, req: IncomingMessage, socket: net.Socket, head: Buffer): void {
  const upstream = net.connect(Number(appOrigin.port), appOrigin.hostname, () => {
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
    for (const [key, value] of Object.entries({ ...req.headers, host: appOrigin.host })) {
      if (Array.isArray(value)) {
        for (const item of value) upstream.write(`${key}: ${item}\r\n`);
      } else if (value !== undefined) {
        upstream.write(`${key}: ${value}\r\n`);
      }
    }
    upstream.write('\r\n');
    if (head.length > 0) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  upstream.on('error', () => socket.destroy());
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
    try {
      await delay(150);
    } catch {
      // Keep polling until Vite has opened its listener.
    }
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
