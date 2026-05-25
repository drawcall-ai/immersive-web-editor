import { expect, test } from '@playwright/test';
import { cleanupStaticEditorOutDirs, createFixtureFieldHarness, createReactThreeStartHarness, type LocalEditorMode } from './local-harness';
import { defineFixtureFieldBehaviorTests, defineReactThreeStartBehaviorTests } from './shared/editor-behavior';

const editorModes: LocalEditorMode[] = ['live preview', 'built'];

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await cleanupStaticEditorOutDirs();
});

for (const mode of editorModes) {
  test.describe(`${mode} editor capabilities`, () => {
    defineFixtureFieldBehaviorTests({ expect, test }, () => createFixtureFieldHarness(mode));
  });
}

for (const mode of editorModes) {
  test.describe(`${mode} editor react-three-start behavior`, () => {
    defineReactThreeStartBehaviorTests({ expect, test }, () => createReactThreeStartHarness(mode));
  });
}
