import type { Message, Part } from '@opencode-ai/sdk/v2/client';

export type SessionMessage = { info: Message; parts: Part[] };

export function applyPartUpdate(list: SessionMessage[], part: Part): SessionMessage[] {
  const messageID = (part as { messageID?: string }).messageID;
  if (!messageID) return list;
  let messageIndex = list.findIndex((message) => message.info.id === messageID);
  let nextList = list;
  if (messageIndex === -1) {
    nextList = [...list, { info: createPendingAssistantMessage(messageID, part), parts: [] }];
    messageIndex = nextList.length - 1;
  }

  const message = nextList[messageIndex];
  const partIndex = message.parts.findIndex((current) => current.id === part.id);
  const parts = partIndex === -1
    ? [...message.parts, part]
    : message.parts.map((current, index) => (index === partIndex ? part : current));

  const next = nextList.slice();
  next[messageIndex] = { ...message, parts };
  return next;
}

export type PartDelta = {
  messageID?: string;
  partID?: string;
  field?: string;
  delta?: unknown;
  sessionID?: string;
};

export function applyPartDelta(list: SessionMessage[], delta: PartDelta): SessionMessage[] {
  if (!delta.messageID || !delta.partID || typeof delta.field !== 'string') return list;
  let messageIndex = list.findIndex((message) => message.info.id === delta.messageID);
  let nextList = list;
  if (messageIndex === -1) {
    nextList = [...list, { info: createPendingAssistantMessage(delta.messageID, delta), parts: [] }];
    messageIndex = nextList.length - 1;
  }

  const message = nextList[messageIndex];
  const partIndex = message.parts.findIndex((part) => part.id === delta.partID);
  const current = partIndex === -1
    ? {
      id: delta.partID,
      sessionID: delta.sessionID ?? message.info.sessionID,
      messageID: delta.messageID,
      type: 'text',
    } as Part & Record<string, unknown>
    : message.parts[partIndex] as Part & Record<string, unknown>;

  const previous = current[delta.field];
  const value = typeof previous === 'string' && typeof delta.delta === 'string'
    ? previous + delta.delta
    : delta.delta;
  const nextPart = { ...current, [delta.field]: value } as Part;
  const parts = partIndex === -1
    ? [...message.parts, nextPart]
    : message.parts.map((part, index) => (index === partIndex ? nextPart : part));

  const next = nextList.slice();
  next[messageIndex] = { ...message, parts };
  return next;
}

function createPendingAssistantMessage(messageID: string, source: { sessionID?: string }): Message {
  return {
    id: messageID,
    sessionID: source.sessionID ?? '',
    role: 'assistant',
    time: { created: Date.now() },
    parentID: '',
    modelID: '',
    providerID: '',
    mode: '',
    agent: '',
    path: { cwd: '', root: '' },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  };
}

export type PromptPart = { type: string; text?: string; [key: string]: unknown };

export function createOptimisticUserMessage(
  sessionID: string,
  parts: PromptPart[],
  model: { providerID: string; modelID: string },
  now = Date.now(),
): SessionMessage {
  const messageID = `local-user-${now.toString(36)}-${Math.random().toString(36).slice(2)}`;
  return {
    info: {
      id: messageID,
      sessionID,
      role: 'user',
      time: { created: now },
      agent: '',
      model,
    },
    parts: parts.map((part, index) => ({
      ...part,
      id: `local-part-${now.toString(36)}-${index}`,
      sessionID,
      messageID,
    })) as Part[],
  };
}

export function appendOptimisticUserMessage(
  list: SessionMessage[],
  message: SessionMessage,
): SessionMessage[] {
  return [...list, message];
}

export function reconcileSessionMessages(
  current: SessionMessage[],
  incoming: SessionMessage[],
): SessionMessage[] {
  return incoming.map((message) => {
    const existing = current.find((candidate) => candidate.info.id === message.info.id);
    if (!existing) return message;
    return {
      info: message.info,
      parts: reconcileParts(existing.parts, message.parts),
    };
  });
}

function reconcileParts(current: Part[], incoming: Part[]): Part[] {
  const currentByID = new Map(current.map((part) => [part.id, part]));
  return incoming.map((part) => {
    const existing = currentByID.get(part.id);
    if (!existing) return part;
    const existingText = (existing as { text?: unknown }).text;
    const incomingText = (part as { text?: unknown }).text;
    if (
      typeof existingText === 'string'
      && typeof incomingText === 'string'
      && existingText.length > incomingText.length
    ) {
      return existing;
    }
    return part;
  });
}

export function applyMessageUpdate(list: SessionMessage[], info: Message): SessionMessage[] {
  const messageIndex = list.findIndex((message) => message.info.id === info.id);
  if (messageIndex === -1) return [...list, { info, parts: [] }];

  const next = list.slice();
  next[messageIndex] = { ...next[messageIndex], info };
  return next;
}

export function applyPartRemoved(list: SessionMessage[], messageID: string, partID: string): SessionMessage[] {
  const messageIndex = list.findIndex((message) => message.info.id === messageID);
  if (messageIndex === -1) return list;

  const next = list.slice();
  next[messageIndex] = {
    ...next[messageIndex],
    parts: next[messageIndex].parts.filter((part) => part.id !== partID),
  };
  return next;
}
