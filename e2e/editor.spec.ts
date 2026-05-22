import { expect, test, type Page } from '@playwright/test';
import { createReadStream, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import net from 'node:net';
import { dirname, extname, resolve } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = resolve(repoRoot, 'e2e/fixtures/vite-app');
const appFile = resolve(appRoot, 'src/main.ts');
const appBaselineFile = resolve(appRoot, 'main.baseline.ts');
const appPublicDir = resolve(appRoot, 'public');
const reactThreeStartExampleRoot = resolve(repoRoot, 'examples/react-three-start');
const staticEditorRoot = resolve(repoRoot, 'packages/editor/src/editor');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const originalAppSource = readFileSync(appBaselineFile, 'utf8');
const originalPublicFiles = new Set(readdirSync(appPublicDir));
let staticEditorBuild: Promise<string> | null = null;
let staticEditorOutDir: string | null = null;

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  if (staticEditorOutDir) await rm(staticEditorOutDir, { recursive: true, force: true });
});

type StartedApp = { origin: string; stop(): Promise<void> };
type StartedEditor = { origin: string; stop(): Promise<void> };
type EditorMode = {
  name: string;
  startEditor(app: StartedApp): Promise<StartedEditor>;
};

const editorModes: EditorMode[] = [
  {
    name: 'live preview',
    async startEditor(app) {
      return { origin: app.origin, stop: async () => undefined };
    },
  },
  {
    name: 'built',
    async startEditor(app) {
      const outDir = await ensureStaticEditorBuild();
      return startStaticEditorHost(outDir, new URL(app.origin));
    },
  },
];

for (const mode of editorModes) {
  test.describe(`${mode.name} editor capabilities`, () => {
    let app: StartedApp;
    let editor: StartedEditor;

    test.beforeAll(async () => {
      resetAppFixture();
      await resetPublicFiles();
      app = await startViteApp();
      editor = await mode.startEditor(app);
    });

    test.afterAll(async () => {
      await editor?.stop();
      await app?.stop();
      resetAppFixture();
      await resetPublicFiles();
    });

    test.beforeEach(async () => {
      resetAppFixture();
      await resetPublicFiles();
    });

    test('edits scalar fields and syncs authored literals back to source', async ({ page }) => {
      await openEditor(page, editor.origin);
      const preview = page.frameLocator('iframe[title="Preview"]');

      await commitTextField(page, 'Fields/Text/title', 'Edited title');
      await commitTextArea(page, 'Fields/Text/subtitle', 'A longer subtitle');
      await commitNumberField(page, 'Fields/Text/count', '7');
      await page.locator(slotSelector('Fields/Text/enabled')).getByRole('checkbox').click();
      await page.locator(slotSelector('Fields/Text/tint')).locator('input[type="color"]').fill('#8844cc');
      await commitJsonField(page, 'Fields/Text/metadata', '{"variant":"beta","score":4}');

      await expect(preview.getByRole('heading', { name: 'Edited title' })).toBeVisible();
      await expect(preview.getByTestId('subtitle')).toHaveText('A longer subtitle');
      await expect(preview.getByTestId('count')).toHaveText('7');
      await expect(preview.getByTestId('enabled')).toHaveText('no');
      await expect(preview.getByTestId('tint')).toHaveText('#8844cc');
      await expect(preview.getByTestId('metadata')).toHaveText('beta:4');

      const source = readFileSync(appFile, 'utf8');
      expect(source).toContain('title: val("Edited title", string');
      expect(source).toContain('count: val(7, number');
      expect(source).toContain('metadata: val({"variant":"beta","score":4}, json');
    });

    test('edits vectors, nested objects, arrays, and optional values', async ({ page }) => {
      await openEditor(page, editor.origin);
      const preview = page.frameLocator('iframe[title="Preview"]');

      await commitVectorComponent(page, 'Fields/Layout/offset', 0, '12');
      await expect(preview.getByTestId('offset')).toHaveText('12,20');
      await commitVectorComponent(page, 'Fields/Layout/offset', 1, '24');
      await commitVectorComponent(page, 'Fields/Layout/marker', 0, '4');
      await expect(preview.getByTestId('marker')).toHaveText('4,2,3');
      await commitVectorComponent(page, 'Fields/Layout/marker', 1, '5');
      await expect(preview.getByTestId('marker')).toHaveText('4,5,3');
      await commitVectorComponent(page, 'Fields/Layout/marker', 2, '6');
      await commitTextField(page, 'Fields/Layout/card/label', 'Card B');
      await expect(preview.getByTestId('card')).toHaveText('Card B:2');
      await commitNumberField(page, 'Fields/Layout/card/size', '5');

      await expect(preview.getByTestId('offset')).toHaveText('12,24');
      await expect(preview.getByTestId('marker')).toHaveText('4,5,6');
      await expect(preview.getByTestId('card')).toHaveText('Card B:5');

      await commitTextField(page, 'Fields/Layout/tags/Tag 1/Tag 1', 'primary');
      await expect(preview.getByTestId('tags')).toHaveText('primary');

      await page.getByRole('button', { name: 'Add Tag' }).click();
      await expect(preview.getByTestId('tags')).toHaveText('primary,new tag');

      await page.getByRole('button', { name: 'Remove Tag 2' }).click();
      await expect(preview.getByTestId('tags')).toHaveText('primary');

      await page.locator(slotSelector('Fields/Layout/maybeNote')).getByRole('button', { name: 'Set value' }).click();
      await expect(preview.getByTestId('note')).toHaveText('draft note');
      await commitTextField(page, 'Fields/Layout/maybeNote', 'ship it');
      await expect(preview.getByTestId('note')).toHaveText('ship it');
      await page.getByRole('button', { name: 'Clear' }).click();
      await expect(preview.getByTestId('note')).toHaveText('none');
    });

    test('selects and uploads public files through file fields', async ({ page }, testInfo) => {
      await openEditor(page, editor.origin);
      const preview = page.frameLocator('iframe[title="Preview"]');
      const fileSlot = page.locator(slotSelector('Fields/Layout/Document file'));
      const select = fileSlot.locator('select');

      await expect(select).toHaveValue('existing.txt');
      await expect(preview.getByTestId('file')).toHaveText('existing.txt');

      const uploadPath = resolve(testInfo.outputDir, 'uploaded-note.txt');
      await mkdir(testInfo.outputDir, { recursive: true });
      writeFileSync(uploadPath, 'Uploaded from Playwright.');
      await fileSlot.locator('input[type="file"]').setInputFiles(uploadPath);

      await expect(select).toHaveValue('uploaded-note.txt');
      await expect(preview.getByTestId('file')).toHaveText('uploaded-note.txt');
      expect(existsSync(resolve(appPublicDir, 'uploaded-note.txt'))).toBe(true);

      const source = readFileSync(appFile, 'utf8');
      expect(source).toContain('documentFile: val("uploaded-note.txt", fileUrl');
    });

    test('runs custom field components, plugin panels, and plugin commands', async ({ page }) => {
      await openEditor(page, editor.origin);
      const preview = page.frameLocator('iframe[title="Preview"]');

      await page.locator(slotSelector('Fields/Text/mood')).getByRole('button', { name: 'hostile' }).click();
      await expect(preview.getByTestId('mood')).toHaveText('hostile');

      await expect(page.getByTestId('plugin-command-count')).toHaveText('Command count: 0');
      await openCommandPalette(page);
      await page.getByRole('option', { name: /Inspector: increment counter/ }).click();
      await expect(page.getByTestId('plugin-command-count')).toHaveText('Command count: 1');
    });

    test('replaces stale authored fields when the preview module hot updates', async ({ page }) => {
      await openEditor(page, editor.origin);
      const preview = page.frameLocator('iframe[title="Preview"]');
      const oldSlot = page.locator(slotSelector('Fields/Text/title'));
      const newSlot = page.locator(slotSelector('Fields/Text/headline'));

      await expect(oldSlot).toBeVisible();
      await expect(newSlot).toHaveCount(0);

      writeFileSync(
        appFile,
        originalAppSource
          .replace('title: val("Hello World"', 'headline: val("Hello World"')
          .replace('text.title', 'text.headline'),
      );

      await expect(newSlot).toBeVisible();
      await expect(oldSlot).toHaveCount(0);
      await expect(preview.getByRole('heading', { name: 'Hello World' })).toBeVisible();
    });
  });
}

for (const mode of editorModes) {
  test.describe(`${mode.name} editor spatial overlay`, () => {
    let app: StartedApp;
    let editor: StartedEditor;

    test.beforeAll(async () => {
      app = await startReactThreeStartExample();
      editor = await mode.startEditor(app);
    });

    test.afterAll(async () => {
      await editor?.stop();
      await app?.stop();
    });

    test('keeps the overlay canvas connected to the preview camera and canvas', async ({ page }) => {
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });

      await openEditor(page, editor.origin);

      const preview = page.frameLocator('iframe[title="Preview"]');
      await expect(page.getByText('HUD Label')).toBeVisible();
      await expect(preview.locator('canvas')).toHaveCount(1);
      await expect(page.locator('canvas')).toHaveCount(1);

      await page.waitForTimeout(500);
      const previewBeforeDrag = await preview.locator('canvas').screenshot();
      const overlayCanvasBox = await page.locator('canvas').boundingBox();
      expect(overlayCanvasBox).not.toBeNull();
      await page.mouse.move(overlayCanvasBox!.x + overlayCanvasBox!.width / 2, overlayCanvasBox!.y + overlayCanvasBox!.height / 2);
      await page.mouse.down();
      await page.mouse.move(overlayCanvasBox!.x + overlayCanvasBox!.width / 2 + 300, overlayCanvasBox!.y + overlayCanvasBox!.height / 2 - 150, { steps: 30 });
      await page.mouse.up();
      await page.waitForTimeout(500);
      const previewAfterDrag = await preview.locator('canvas').screenshot();

      expect(countBufferDiffs(previewBeforeDrag, previewAfterDrag)).toBeGreaterThan(1000);
      expect(pageErrors).not.toContainEqual(expect.stringContaining('Hooks can only be used within the Canvas component'));
      expect(consoleErrors).not.toContainEqual(expect.stringContaining('Hooks can only be used within the Canvas component'));
    });
  });
}

function resetAppFixture(): void {
  writeFileSync(appFile, originalAppSource);
}

async function resetPublicFiles(): Promise<void> {
  await mkdir(appPublicDir, { recursive: true });
  for (const entry of readdirSync(appPublicDir)) {
    if (!originalPublicFiles.has(entry)) {
      await rm(resolve(appPublicDir, entry), { recursive: true, force: true });
    }
  }
}

async function openEditor(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/editor`);
  await expect(page.frameLocator('iframe[title="Preview"]').getByText('Vite editor fixture').or(page.frameLocator('iframe[title="Preview"]').getByText('Edit values at /editor'))).toBeVisible();
}

function slotSelector(path: string): string {
  return `[data-editor-slot-path="${path}"]`;
}

async function commitTextField(page: Page, path: string, value: string): Promise<void> {
  const input = page.locator(slotSelector(path)).locator('input:not([type]), input[type="text"]').first();
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.press('Enter');
}

async function commitTextArea(page: Page, path: string, value: string): Promise<void> {
  const textarea = page.locator(slotSelector(path)).locator('textarea').first();
  await expect(textarea).toBeVisible();
  await textarea.fill(value);
  await textarea.blur();
}

async function commitNumberField(page: Page, path: string, value: string): Promise<void> {
  const input = page.locator(slotSelector(path)).locator('input[type="number"]').first();
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.press('Enter');
}

async function commitJsonField(page: Page, path: string, value: string): Promise<void> {
  const textarea = page.locator(slotSelector(path)).locator('textarea').first();
  await expect(textarea).toBeVisible();
  await textarea.fill(value);
  await textarea.blur();
}

async function commitVectorComponent(page: Page, path: string, index: number, value: string): Promise<void> {
  const inputs = page.locator(slotSelector(path)).locator('input[type="number"]');
  await expect(inputs.nth(index)).toBeVisible();
  await inputs.nth(index).fill(value);
  await inputs.nth(index).press('Enter');
}

async function openCommandPalette(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+K');
  const input = page.getByPlaceholder(/Type a command/);
  if (await input.count() === 0) {
    await page.keyboard.press(process.platform === 'darwin' ? 'Control+K' : 'Meta+K');
  }
  await expect(input).toBeVisible();
}

function countBufferDiffs(left: Buffer, right: Buffer): number {
  const length = Math.min(left.length, right.length);
  let diffs = Math.abs(left.length - right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) diffs += 1;
  }
  return diffs;
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

async function ensureStaticEditorBuild(): Promise<string> {
  if (staticEditorBuild) return staticEditorBuild;
  staticEditorOutDir = resolve(staticEditorRoot, `.e2e-editor-dist-${process.pid}-${Date.now()}`);
  staticEditorBuild = (async () => {
    await mkdir(staticEditorOutDir!, { recursive: true });
    await runCommand(
      pnpm,
      ['exec', 'vite', 'build', '--config', resolve(repoRoot, 'e2e/editor-static.vite.config.ts'), '--outDir', staticEditorOutDir!, '--emptyOutDir'],
      repoRoot,
      { E2E_PREVIEW_URL: '/' },
    );
    return staticEditorOutDir!;
  })();
  return staticEditorBuild;
}

async function startStaticEditorHost(
  staticDir: string,
  appOrigin: URL,
): Promise<StartedEditor> {
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
