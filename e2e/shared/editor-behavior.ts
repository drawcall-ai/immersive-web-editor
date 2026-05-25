import type { Page, TestInfo } from '@playwright/test';

type TestApi = typeof import('@playwright/test').test;
type ExpectApi = typeof import('@playwright/test').expect;

export interface EditorBehaviorTestApi {
  test: TestApi;
  expect: ExpectApi;
}

export interface EditorHarness {
  name: string;
  setup(): Promise<void>;
  teardown(): Promise<void>;
  openEditor(page: Page): Promise<void>;
  createUploadFile?(testInfo: TestInfo, name: string, content: string): Promise<string>;
}

export function defineFixtureFieldBehaviorTests(api: EditorBehaviorTestApi, createHarness: () => EditorHarness): void {
  const { expect, test } = api;

  test.describe('editor fixture field behavior', () => {
    let harness: EditorHarness;

    test.beforeEach(async () => {
      harness = createHarness();
      await harness.setup();
    });

    test.afterEach(async () => {
      await harness.teardown();
    });

    test('edits scalar fields and updates the preview', async ({ page }) => {
      await harness.openEditor(page);
      const preview = page.frameLocator('iframe[title="Preview"]');

      await commitTextField(expect, page, 'Fields/Text/title', 'Edited title');
      await expect(preview.getByRole('heading', { name: 'Edited title' })).toBeVisible();
      await commitTextArea(expect, page, 'Fields/Text/subtitle', 'A longer subtitle');
      await expect(preview.getByTestId('subtitle')).toHaveText('A longer subtitle');
      await commitNumberField(expect, page, 'Fields/Text/count', '7');
      await expect(preview.getByTestId('count')).toHaveText('7');
      await page.locator(slotSelector('Fields/Text/enabled')).getByRole('checkbox').click();
      await expect(preview.getByTestId('enabled')).toHaveText('no');
      await page.locator(slotSelector('Fields/Text/tint')).locator('input[type="color"]').fill('#8844cc');
      await expect(preview.getByTestId('tint')).toHaveText('#8844cc');
      await commitJsonField(expect, page, 'Fields/Text/metadata', '{"variant":"beta","score":4}');

      await expect(preview.getByTestId('metadata')).toHaveText('beta:4');
    });

    test('edits vector fields', async ({ page }) => {
      await harness.openEditor(page);
      const preview = page.frameLocator('iframe[title="Preview"]');

      await commitVectorComponent(expect, page, 'Fields/Layout/offset', 0, '12');
      await expect(preview.getByTestId('offset')).toHaveText('12,20');
      await commitVectorComponent(expect, page, 'Fields/Layout/offset', 1, '24');
      await expect(preview.getByTestId('offset')).toHaveText('12,24');
      await commitVectorComponent(expect, page, 'Fields/Layout/marker', 0, '4');
      await expect(preview.getByTestId('marker')).toHaveText('4,2,3');
      await commitVectorComponent(expect, page, 'Fields/Layout/marker', 1, '5');
      await expect(preview.getByTestId('marker')).toHaveText('4,5,3');
      await commitVectorComponent(expect, page, 'Fields/Layout/marker', 2, '6');
      await expect(preview.getByTestId('marker')).toHaveText('4,5,6');
    });

    test('edits nested object fields', async ({ page }) => {
      await harness.openEditor(page);
      const preview = page.frameLocator('iframe[title="Preview"]');

      await commitTextField(expect, page, 'Fields/Layout/card/label', 'Card B');
      await expect(preview.getByTestId('card')).toHaveText('Card B:2');
      await commitNumberField(expect, page, 'Fields/Layout/card/size', '5');
      await expect(preview.getByTestId('card')).toHaveText('Card B:5');
    });

    test('edits array items', async ({ page }) => {
      await harness.openEditor(page);
      const preview = page.frameLocator('iframe[title="Preview"]');

      await commitTextField(expect, page, 'Fields/Layout/tags/Tag 1/Tag 1', 'primary');
      await expect(preview.getByTestId('tags')).toHaveText('primary');
    });

    test('adds and removes array items', async ({ page }) => {
      await harness.openEditor(page);
      const preview = page.frameLocator('iframe[title="Preview"]');

      await page.getByRole('button', { name: 'Add Tag' }).click();
      await expect(preview.getByTestId('tags')).toHaveText('alpha,new tag');

      await page.getByRole('button', { name: 'Remove Tag 2' }).click();
      await expect(preview.getByTestId('tags')).toHaveText('alpha');
    });

    test('sets, edits, and clears optional values', async ({ page }) => {
      await harness.openEditor(page);
      const preview = page.frameLocator('iframe[title="Preview"]');

      await page.locator(slotSelector('Fields/Layout/maybeNote')).getByRole('button', { name: 'Set value' }).click();
      await expect(preview.getByTestId('note')).toHaveText('draft note');
      await commitTextField(expect, page, 'Fields/Layout/maybeNote', 'ship it');
      await expect(preview.getByTestId('note')).toHaveText('ship it');
      await page.getByRole('button', { name: 'Clear' }).click();
      await expect(preview.getByTestId('note')).toHaveText('none');
    });

    test('selects and uploads public files through file fields', async ({ page }, testInfo) => {
      test.skip(!harness.createUploadFile, 'Harness does not support local upload files.');

      await harness.openEditor(page);
      const preview = page.frameLocator('iframe[title="Preview"]');
      const fileSlot = page.locator(slotSelector('Fields/Layout/Document file'));
      const select = fileSlot.locator('select');

      await expect(select).toHaveValue('existing.txt');
      await expect(preview.getByTestId('file')).toHaveText('existing.txt');

      const uploadPath = await harness.createUploadFile!(testInfo, 'uploaded-note.txt', 'Uploaded from Playwright.');
      await fileSlot.locator('input[type="file"]').setInputFiles(uploadPath);

      await expect(select).toHaveValue('uploaded-note.txt');
      await expect(preview.getByTestId('file')).toHaveText('uploaded-note.txt');
    });

    test('runs custom field components, plugin panels, and plugin commands', async ({ page }) => {
      await harness.openEditor(page);
      const preview = page.frameLocator('iframe[title="Preview"]');

      await page.locator(slotSelector('Fields/Text/mood')).getByRole('button', { name: 'hostile' }).click();
      await expect(preview.getByTestId('mood')).toHaveText('hostile');

      await expect(page.getByTestId('plugin-command-count')).toHaveText('Command count: 0');
      await openCommandPalette(expect, page);
      await page.getByRole('option', { name: /Inspector: increment counter/ }).click();
      await expect(page.getByTestId('plugin-command-count')).toHaveText('Command count: 1');
    });

    test('keeps authored values after a full page reload', async ({ page }) => {
      await harness.openEditor(page);

      await commitTextField(expect, page, 'Fields/Text/title', 'Reloaded title');

      await page.reload();
      const preview = page.frameLocator('iframe[title="Preview"]');
      await expect(preview.getByRole('heading', { name: 'Reloaded title' })).toBeVisible();
      await expect(page.locator(slotSelector('Fields/Text/title')).locator('input').first()).toHaveValue('Reloaded title');
    });
  });
}

export function defineReactThreeStartBehaviorTests(api: EditorBehaviorTestApi, createHarness: () => EditorHarness): void {
  const { expect, test } = api;

  test.describe('react-three-start editor behavior', () => {
    let harness: EditorHarness;

    test.beforeEach(async () => {
      harness = createHarness();
      await harness.setup();
    });

    test.afterEach(async () => {
      await harness.teardown();
    });

    test('updates the preview and survives a full page reload', async ({ page }) => {
      await harness.openEditor(page);
      const preview = page.frameLocator('iframe[title="Preview"]');

      await commitTextField(expect, page, 'Fields/HUD Label/HUD Label', 'Reload verified label');
      await expect(preview.getByText('Reload verified label')).toBeVisible();

      await page.reload();
      await expect(preview.getByText('Reload verified label')).toBeVisible();
      await expect(page.locator(slotSelector('Fields/HUD Label/HUD Label')).locator('input').first()).toHaveValue('Reload verified label');
    });

    test('keeps the overlay canvas connected to the preview camera and canvas', async ({ page }) => {
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });

      await harness.openEditor(page);

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

export async function expectEditorReady(page: Page, expect: ExpectApi): Promise<void> {
  await expect(page.frameLocator('iframe[title="Preview"]').getByText('Vite editor fixture').or(page.frameLocator('iframe[title="Preview"]').getByText('Edit values at /editor'))).toBeVisible();
}

export function slotSelector(path: string): string {
  return `:is([data-editor-slot-path="${path}"], [data-editor-slot-path$="/${path}"])`;
}

async function commitTextField(expect: ExpectApi, page: Page, path: string, value: string): Promise<void> {
  const input = page.locator(slotSelector(path)).locator('input:not([type]), input[type="text"]').first();
  await expect(input).toBeVisible();
  await input.fill(value);
  await expect(input).toHaveValue(value);
  await input.blur();
}

async function commitTextArea(expect: ExpectApi, page: Page, path: string, value: string): Promise<void> {
  const textarea = page.locator(slotSelector(path)).locator('textarea').first();
  await expect(textarea).toBeVisible();
  await textarea.fill(value);
  await expect(textarea).toHaveValue(value);
  await textarea.blur();
}

async function commitNumberField(expect: ExpectApi, page: Page, path: string, value: string): Promise<void> {
  const input = page.locator(slotSelector(path)).locator('input[type="number"]').first();
  await expect(input).toBeVisible();
  await input.fill(value);
  await expect(input).toHaveValue(value);
  await input.blur();
}

async function commitJsonField(expect: ExpectApi, page: Page, path: string, value: string): Promise<void> {
  const textarea = page.locator(slotSelector(path)).locator('textarea').first();
  await expect(textarea).toBeVisible();
  await textarea.fill(value);
  await textarea.blur();
}

async function commitVectorComponent(expect: ExpectApi, page: Page, path: string, index: number, value: string): Promise<void> {
  const inputs = page.locator(slotSelector(path)).locator('input[type="number"]');
  await expect(inputs.nth(index)).toBeVisible();
  await inputs.nth(index).fill(value);
  await expect(inputs.nth(index)).toHaveValue(value);
  await inputs.nth(index).blur();
}

async function openCommandPalette(expect: ExpectApi, page: Page): Promise<void> {
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
