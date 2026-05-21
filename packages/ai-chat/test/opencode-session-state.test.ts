import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appendOptimisticUserMessage,
  applyMessageUpdate,
  applyPartDelta,
  applyPartRemoved,
  applyPartUpdate,
  createOptimisticUserMessage,
  reconcileSessionMessages,
} from '../dist/client/opencode-session-state.js';

const message = (overrides = {}) => ({
  id: 'message-1',
  sessionID: 'session-1',
  role: 'assistant',
  time: { created: 1 },
  ...overrides,
});

const textPart = (overrides = {}) => ({
  id: 'part-1',
  sessionID: 'session-1',
  messageID: 'message-1',
  type: 'text',
  text: 'hello',
  ...overrides,
});

test('applyMessageUpdate appends a new message with no parts', () => {
  const info = message();

  assert.deepEqual(applyMessageUpdate([], info), [{ info, parts: [] }]);
});

test('applyMessageUpdate replaces message info while preserving parts', () => {
  const part = textPart();
  const list = [{ info: message({ role: 'assistant' }), parts: [part] }];

  const next = applyMessageUpdate(list, message({ role: 'user' }));

  assert.equal(next[0].info.role, 'user');
  assert.deepEqual(next[0].parts, [part]);
  assert.notEqual(next, list);
});

test('applyPartUpdate inserts or replaces parts for an existing message', () => {
  const list = [{ info: message(), parts: [] }];

  const inserted = applyPartUpdate(list, textPart());
  assert.deepEqual(inserted[0].parts, [textPart()]);

  const replaced = applyPartUpdate(inserted, textPart({ text: 'updated' }));
  assert.equal(replaced[0].parts.length, 1);
  assert.equal(replaced[0].parts[0].text, 'updated');
});

test('applyPartUpdate preserves parts that arrive before message info', () => {
  const next = applyPartUpdate([], textPart());

  assert.equal(next.length, 1);
  assert.equal(next[0].info.id, 'message-1');
  assert.equal(next[0].info.sessionID, 'session-1');
  assert.equal(next[0].info.role, 'assistant');
  assert.deepEqual(next[0].parts, [textPart()]);
});

test('applyPartUpdate ignores parts without a message id', () => {
  const list = [{ info: message(), parts: [] }];

  assert.equal(applyPartUpdate(list, { ...textPart(), messageID: undefined }), list);
});

test('applyPartDelta appends string deltas to an existing field', () => {
  const list = [{ info: message(), parts: [textPart({ text: 'hel' })] }];

  const next = applyPartDelta(list, {
    sessionID: 'session-1',
    messageID: 'message-1',
    partID: 'part-1',
    field: 'text',
    delta: 'lo',
  });

  assert.equal(next[0].parts[0].text, 'hello');
});

test('applyPartDelta creates a text part when the part has not arrived yet', () => {
  const list = [{ info: message(), parts: [] }];

  const next = applyPartDelta(list, {
    sessionID: 'session-1',
    messageID: 'message-1',
    partID: 'part-1',
    field: 'text',
    delta: 'streaming',
  });

  assert.deepEqual(next[0].parts, [textPart({ text: 'streaming' })]);
});

test('applyPartDelta replaces non-string fields with the latest delta value', () => {
  const list = [{ info: message(), parts: [textPart({ count: 1 })] }];

  const next = applyPartDelta(list, {
    messageID: 'message-1',
    partID: 'part-1',
    field: 'count',
    delta: 2,
  });

  assert.equal(next[0].parts[0].count, 2);
});

test('applyPartDelta creates a pending assistant message when the message has not arrived yet', () => {
  const next = applyPartDelta([], {
    sessionID: 'session-1',
    messageID: 'message-1',
    partID: 'part-1',
    field: 'text',
    delta: 'early',
  });

  assert.equal(next.length, 1);
  assert.equal(next[0].info.id, 'message-1');
  assert.equal(next[0].info.sessionID, 'session-1');
  assert.equal(next[0].info.role, 'assistant');
  assert.equal(next[0].parts[0].text, 'early');
});

test('applyPartDelta ignores incomplete deltas', () => {
  const list = [{ info: message(), parts: [textPart()] }];

  assert.equal(applyPartDelta(list, { partID: 'part-1', field: 'text', delta: '!' }), list);
  assert.equal(applyPartDelta(list, { messageID: 'message-1', field: 'text', delta: '!' }), list);
  assert.equal(applyPartDelta(list, { messageID: 'message-1', partID: 'part-1', delta: '!' }), list);
});

test('applyPartRemoved removes matching parts only', () => {
  const list = [{
    info: message(),
    parts: [textPart({ id: 'part-1' }), textPart({ id: 'part-2', text: 'keep' })],
  }];

  const next = applyPartRemoved(list, 'message-1', 'part-1');

  assert.deepEqual(next[0].parts, [textPart({ id: 'part-2', text: 'keep' })]);
  assert.equal(applyPartRemoved(list, 'missing', 'part-1'), list);
});

test('createOptimisticUserMessage builds a local user message from prompt parts', () => {
  const optimistic = createOptimisticUserMessage(
    'session-1',
    [{ type: 'text', text: 'show me immediately' }],
    { providerID: 'openai', modelID: 'gpt-4.1-mini' },
    123,
  );

  assert.equal(optimistic.info.sessionID, 'session-1');
  assert.equal(optimistic.info.role, 'user');
  assert.deepEqual(optimistic.info.model, { providerID: 'openai', modelID: 'gpt-4.1-mini' });
  assert.equal(optimistic.parts[0].messageID, optimistic.info.id);
  assert.equal(optimistic.parts[0].text, 'show me immediately');
});

test('appendOptimisticUserMessage appends without mutating the previous list', () => {
  const list = [{ info: message(), parts: [] }];
  const optimistic = createOptimisticUserMessage(
    'session-1',
    [{ type: 'text', text: 'hi' }],
    { providerID: 'openai', modelID: 'gpt-4.1-mini' },
    123,
  );

  const next = appendOptimisticUserMessage(list, optimistic);

  assert.equal(list.length, 1);
  assert.equal(next.length, 2);
  assert.equal(next[1], optimistic);
});

test('reconcileSessionMessages replaces local user messages with server history', () => {
  const optimistic = createOptimisticUserMessage(
    'session-1',
    [{ type: 'text', text: 'hi' }],
    { providerID: 'openai', modelID: 'gpt-4.1-mini' },
    123,
  );
  const serverUser = { info: message({ id: 'server-user', role: 'user' }), parts: [textPart({ messageID: 'server-user', text: 'hi' })] };

  assert.deepEqual(reconcileSessionMessages([optimistic], [serverUser]), [serverUser]);
});

test('reconcileSessionMessages preserves longer streamed text over an older snapshot', () => {
  const streamed = [{
    info: message({ id: 'assistant-1' }),
    parts: [textPart({ id: 'part-1', messageID: 'assistant-1', text: 'streaming response' })],
  }];
  const snapshot = [{
    info: message({ id: 'assistant-1' }),
    parts: [textPart({ id: 'part-1', messageID: 'assistant-1', text: '' })],
  }];

  const next = reconcileSessionMessages(streamed, snapshot);

  assert.equal(next[0].parts[0].text, 'streaming response');
});
