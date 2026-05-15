/// <reference path="../lucide-icon-modules.d.ts" />

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import Bot from 'lucide-react/dist/esm/icons/bot.js';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import GitBranch from 'lucide-react/dist/esm/icons/git-branch.js';
import ImagePlus from 'lucide-react/dist/esm/icons/image-plus.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js';
import MessageSquarePlus from 'lucide-react/dist/esm/icons/message-square-plus.js';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js';
import Send from 'lucide-react/dist/esm/icons/send.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { css } from '@emotion/css';
import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2/client';
import {
  appendOptimisticUserMessage,
  applyMessageUpdate,
  applyPartDelta,
  applyPartRemoved,
  applyPartUpdate,
  createOptimisticUserMessage,
  reconcileSessionMessages,
  type SessionMessage,
} from './opencode-session-state.js';
import type {
  Event,
  FilePartInput,
  Part,
  PermissionRequest,
  Provider,
  QuestionRequest,
  Session,
  SnapshotFileDiff,
  Todo,
} from '@opencode-ai/sdk/v2/client';

const DEFAULT_MODEL_PROVIDER = 'opencode';
const DEFAULT_MODEL_ID = 'big-pickle';
const CHAT_LOADING_SLOT_ID = 'editor:chat:loading';

const panelStyles = {
  root: css({
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    overflow: 'hidden',
    background: '#ffffff',
    color: '#09090b',
    fontSize: 12,
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Inter", "SF Pro Text", system-ui, sans-serif',
    '& button, & textarea, & select': { font: 'inherit' },
    '& .dc-chat': { position: 'relative', flex: '1 1 0', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#ffffff' },
    '& .dc-child-strip': { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderBottom: '1px solid #e4e4e7', color: '#a1a1aa', overflowX: 'auto' },
    '& .dc-child-strip button': { border: '1px solid #e4e4e7', background: '#f8fafc', color: '#09090b', borderRadius: 999, padding: '3px 8px', fontSize: 11, whiteSpace: 'nowrap', cursor: 'pointer' },
    '& .dc-messages': { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 },
    '& .dc-empty-state, & .dc-empty-card': { display: 'grid', placeItems: 'center', color: '#a1a1aa' },
    '& .dc-empty-state': { gap: 8, minHeight: 120 },
    '& .dc-empty-card': { alignSelf: 'center', gap: 6, maxWidth: 300, padding: 18, textAlign: 'center', border: '1px solid #e4e4e7', borderRadius: 8, background: '#ffffff' },
    '& .dc-empty-title': { color: '#09090b', fontWeight: 650 },
    '& .dc-alert': { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid #fecaca', borderRadius: 6, background: '#fef2f2', color: '#991b1b' },
    '& .dc-message': { border: '1px solid #e4e4e7', borderRadius: 8, background: '#ffffff', padding: 10 },
    '& .dc-role-user': { alignSelf: 'flex-end', maxWidth: '86%', background: '#f8fafc' },
    '& .dc-role-assistant, & .dc-role-system': { alignSelf: 'stretch' },
    '& .dc-message-head': { display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6, color: '#52525b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0 },
    '& .dc-message-actions': { display: 'flex', gap: 4, opacity: 0 },
    '& .dc-message:hover .dc-message-actions, & .dc-message:focus-within .dc-message-actions': { opacity: 1 },
    '& .dc-message-actions button, & .dc-icon-button': { width: 30, height: 30, display: 'inline-grid', placeItems: 'center', border: '1px solid #e4e4e7', borderRadius: 7, background: '#ffffff', color: '#52525b', cursor: 'pointer' },
    '& .dc-message-actions button:hover, & .dc-icon-button:hover:not(:disabled)': { color: '#09090b', background: '#fafafa' },
    '& .dc-icon-button:disabled': { opacity: 0.45, cursor: 'not-allowed' },
    '& .dc-prose': { lineHeight: 1.55, color: '#09090b' },
    '& .dc-prose > :first-child': { marginTop: 0 },
    '& .dc-prose > :last-child': { marginBottom: 0 },
    '& .dc-prose p, & .dc-prose ul, & .dc-prose ol': { margin: '0 0 8px' },
    '& .dc-prose ul, & .dc-prose ol': { paddingLeft: 20 },
    '& .dc-prose code, & .dc-code, & .dc-tool code, & .dc-file code, & .dc-permission-patterns code': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, "JetBrains Mono", monospace' },
    '& .dc-prose code': { background: '#fafafa', border: '1px solid #e4e4e7', borderRadius: 4, padding: '1px 4px' },
    '& .dc-prose pre, & .dc-code': { overflow: 'auto', background: '#fafafa', border: '1px solid #e4e4e7', borderRadius: 6, padding: 10, fontSize: 11 },
    '& .dc-tool, & .dc-file, & .dc-todos, & .dc-question, & .dc-diff-panel': { border: '1px solid #e4e4e7', borderRadius: 7, background: '#ffffff' },
    '& .dc-tool, & .dc-file': { padding: 8, display: 'grid', gap: 6 },
    '& .dc-badge': { display: 'inline-flex', alignItems: 'center', border: '1px solid #e4e4e7', borderRadius: 999, padding: '1px 6px', fontSize: 10, textTransform: 'uppercase' },
    '& .dc-badge-completed': { color: '#166534', background: '#f0fdf4', borderColor: '#bbf7d0' },
    '& .dc-badge-error': { color: '#991b1b', background: '#fef2f2', borderColor: '#fecaca' },
    '& .dc-badge-running, & .dc-badge-pending': { color: '#1d4ed8', background: '#eff6ff', borderColor: '#bfdbfe' },
    '& .dc-question': { padding: 10, display: 'grid', gap: 8 },
    '& .dc-question-options': { display: 'grid', gap: 6 },
    '& .dc-option': { display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: 8, padding: 8, border: '1px solid #e4e4e7', borderRadius: 6, cursor: 'pointer' },
    '& .dc-option:hover, & .dc-option.selected': { background: '#fafafa', borderColor: '#d4d4d8' },
    '& .dc-question-custom': { width: '100%', boxSizing: 'border-box', border: '1px solid #e4e4e7', borderRadius: 6, padding: 8 },
    '& .dc-question-actions': { display: 'flex', justifyContent: 'flex-end', gap: 6 },
    '& .dc-question-actions button, & .dc-alert button': { border: '1px solid #e4e4e7', borderRadius: 6, background: '#ffffff', padding: '5px 9px', cursor: 'pointer' },
    '& .dc-question-reject': { color: '#991b1b' },
    '& .dc-composer-shell': { flex: '0 0 auto', borderTop: '1px solid #e4e4e7', padding: 10, background: '#ffffff' },
    '& .dc-attachments': { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
    '& .dc-attachment': { display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 220, border: '1px solid #e4e4e7', borderRadius: 999, padding: '3px 7px', background: '#fafafa' },
    '& .dc-composer': { border: '1px solid #e4e4e7', borderRadius: 8, background: '#ffffff', overflow: 'hidden' },
    '& .dc-composer:focus-within': { borderColor: '#d4d4d8' },
    '& .dc-composer textarea': { width: '100%', boxSizing: 'border-box', resize: 'none', border: 0, outline: 'none', padding: 10, minHeight: 58, color: '#09090b', background: 'transparent' },
    '& .dc-composer-toolbar': { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderTop: '1px solid #e4e4e7' },
    '& .dc-model-select': { display: 'inline-flex', alignItems: 'center', gap: 6, color: '#52525b', minWidth: 0 },
    '& .dc-model-select select': { minWidth: 0, maxWidth: 260, border: '1px solid #e4e4e7', borderRadius: 6, background: '#ffffff', color: '#09090b', padding: '4px 24px 4px 7px' },
    '& .dc-send': { marginLeft: 'auto', border: 0, borderRadius: 7, background: '#111827', color: '#ffffff', display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 30, padding: '0 10px', cursor: 'pointer' },
    '& .dc-send:disabled': { opacity: 0.45, cursor: 'not-allowed' },
    '& .dc-connection-overlay': { position: 'absolute', inset: 0, zIndex: 5, display: 'grid', placeItems: 'center', background: 'rgba(255, 255, 255, 0.78)', color: '#52525b', pointerEvents: 'none' },
    '& .dc-connection-card': { display: 'inline-grid', placeItems: 'center', gap: 8, padding: 14, fontSize: 12 },
    '& .spin': { animation: 'iwe-ai-spin 900ms linear infinite' },
    '@keyframes iwe-ai-spin': { to: { transform: 'rotate(360deg)' } },
  }),
};

marked.setOptions({ gfm: true, breaks: true });

function renderMarkdown(src: string): string {
  const raw = marked.parse(src, { async: false }) as string;
  return DOMPurify.sanitize(raw);
}

type AiStatus = { state: 'disabled' | 'starting' | 'ready' | 'error'; message?: string };
type AttachedFile = FilePartInput & { localID: string };
type ModelChoice = { providerID: string; modelID: string; label: string; attachment: boolean };
type ProviderListPayload = { all?: Provider[]; default?: Record<string, string>; connected?: string[] };
type ProviderCatalog = { providers: Provider[]; defaults: Record<string, string>; connected: string[] };
type SessionData = {
  messages: SessionMessage[];
  questions: QuestionRequest[];
  permissions: PermissionRequest[];
  children: Session[];
};

export interface EditorApi {
  addField(opts: {
    id: string;
    title: string;
    actions?: Array<{
      id: string;
      label: string;
      icon?: ComponentType<any> | string;
      disabled?: boolean;
      run: () => void | Promise<void>;
    }>;
    mount: (container: HTMLElement) => () => void;
  }): () => void;
  removeField(id: string): void;
}

const queryKeys = {
  sessions: ['opencode', 'sessions'] as const,
  providers: ['opencode', 'providers'] as const,
  sessionData: (sessionID: string) => ['opencode', 'session', sessionID] as const,
};

function createClient(): OpencodeClient {
  return createOpencodeClient({ baseUrl: `${window.location.origin}/__editor/oc` });
}

function formatTime(ts?: number): string {
  if (!ts) return '';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(ts);
}

function modelValue(providerID: string, modelID: string): string {
  return `${providerID}::${modelID}`;
}

function splitModelValue(value: string): { providerID: string; modelID: string } {
  const idx = value.indexOf('::');
  if (idx === -1) return { providerID: DEFAULT_MODEL_PROVIDER, modelID: DEFAULT_MODEL_ID };
  return { providerID: value.slice(0, idx), modelID: value.slice(idx + 2) };
}

async function fileToPart(file: File): Promise<AttachedFile> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
  return {
    localID: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
    type: 'file',
    mime: file.type || 'application/octet-stream',
    filename: file.name,
    url,
  };
}

function modelChoicesFromCatalog(catalog: ProviderCatalog): ModelChoice[] {
  const connected = new Set(catalog.connected);
  const visibleProviders = connected.size > 0
    ? catalog.providers.filter((provider) => connected.has(provider.id))
    : catalog.providers;
  const choices = visibleProviders.flatMap((provider) =>
    Object.values(provider.models ?? {}).map((model) => ({
      providerID: provider.id,
      modelID: model.id,
      label: `${provider.name || provider.id} / ${model.name || model.id}`,
      attachment: !!model.capabilities?.attachment || !!model.capabilities?.input?.image,
    })),
  );
  const active = choices.filter((m) => !m.label.toLowerCase().includes('deprecated'));
  return active.length ? active : choices;
}

function normalizeProviderCatalog(input: unknown): ProviderCatalog {
  if (Array.isArray(input)) return { providers: input as Provider[], defaults: {}, connected: [] };
  if (input && typeof input === 'object') {
    const payload = input as ProviderListPayload;
    return {
      providers: payload.all ?? [],
      defaults: payload.default ?? {},
      connected: payload.connected ?? [],
    };
  }
  return { providers: [], defaults: {}, connected: [] };
}

function firstModelValue(provider: Provider | undefined, preferredModelID?: string): string | null {
  if (!provider) return null;
  if (preferredModelID && provider.models?.[preferredModelID]) {
    return modelValue(provider.id, preferredModelID);
  }
  const first = Object.values(provider.models ?? {}).find((model) => !model.name?.toLowerCase().includes('deprecated'))
    ?? Object.values(provider.models ?? {})[0];
  return first ? modelValue(provider.id, first.id) : null;
}

function preferredModelValue(catalog: ProviderCatalog): string {
  const byID = new Map(catalog.providers.map((provider) => [provider.id, provider]));
  const connected = catalog.connected
    .map((providerID) => byID.get(providerID))
    .filter((provider): provider is Provider => Boolean(provider));

  for (const provider of connected) {
    const value = firstModelValue(provider, catalog.defaults[provider.id]);
    if (value) return value;
  }

  return firstModelValue(byID.get(DEFAULT_MODEL_PROVIDER), catalog.defaults[DEFAULT_MODEL_PROVIDER])
    ?? firstModelValue(catalog.providers[0], catalog.defaults[catalog.providers[0]?.id ?? ''])
    ?? modelValue(DEFAULT_MODEL_PROVIDER, DEFAULT_MODEL_ID);
}

function sortSessions(list: Session[]): Session[] {
  return [...list].sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0));
}

function mergeSessions(current: Session[], incoming: Session | Session[]): Session[] {
  const map = new Map<string, Session>();
  for (const session of current) map.set(session.id, session);
  for (const session of Array.isArray(incoming) ? incoming : [incoming]) map.set(session.id, session);
  return sortSessions([...map.values()]);
}

function removeSession(list: Session[], sessionID: string): Session[] {
  return list.filter((session) => session.id !== sessionID);
}

function removeByID<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((item) => item.id !== id);
}

function upsertByID<T extends { id: string }>(list: T[], item: T): T[] {
  return list.some((current) => current.id === item.id)
    ? list.map((current) => (current.id === item.id ? item : current))
    : [...list, item];
}

function compactTitle(session: Session): string {
  const title = session.title?.trim();
  if (title && title.toLowerCase() !== 'example') return title;
  return session.slug || session.id.slice(0, 8);
}

export function Panel({ editor }: { editor: EditorApi }) {
  const client = useMemo(createClient, []);
  const queryClient = useQueryClient();
  const registeredSlotsRef = useRef(new Set<string>());
  const creatingSessionRef = useRef(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: async () => {
      const res = await client.session.list({ roots: true, limit: 80 });
      return sortSessions((res.data ?? []) as Session[]);
    },
  });

  const sessions = sessionsQuery.data ?? [];

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const res = await client.session.create();
      if (!res.data) throw new Error('session.create returned no data');
      return res.data as Session;
    },
    onSuccess: (created) => {
      queryClient.setQueryData<Session[]>(queryKeys.sessions, (prev = []) => mergeSessions(prev, created));
    },
    onError: (e) => setErr((e as Error).message),
    onSettled: () => {
      creatingSessionRef.current = false;
      setCreatingSession(false);
    },
  });

  const newChat = useCallback(() => {
    if (creatingSessionRef.current) return;
    creatingSessionRef.current = true;
    setCreatingSession(true);
    createSessionMutation.mutate();
  }, [createSessionMutation]);

  useEffect(() => {
    if (sessionsQuery.isLoading || sessions.length > 0 || createSessionMutation.isPending || creatingSessionRef.current) return;
    newChat();
  }, [createSessionMutation.isPending, newChat, sessions.length, sessionsQuery.isLoading]);

  useEffect(() => {
    if (sessions.length > 0) {
      editor.removeField(CHAT_LOADING_SLOT_ID);
      return undefined;
    }

    editor.addField({
      id: CHAT_LOADING_SLOT_ID,
      title: 'Chat',
      actions: [
        {
          id: 'new',
          label: creatingSession ? 'Creating session' : 'Create session',
          icon: MessageSquarePlus,
          disabled: creatingSession,
          run: newChat,
        },
      ],
      mount(container) {
        const root = createRoot(container);
        root.render(<ChatLoadingPanel />);
        return () => queueMicrotask(() => root.unmount());
      },
    });

    return () => editor.removeField(CHAT_LOADING_SLOT_ID);
  }, [creatingSession, editor, newChat, sessions.length]);

  useEffect(() => {
    const nextSlotIds = new Set<string>();
    for (const session of sessions) {
      const slotID = `editor:chat:session:${session.id}`;
      nextSlotIds.add(slotID);
      editor.addField({
        id: slotID,
        title: compactTitle(session),
        actions: [
          {
            id: 'new',
            label: creatingSession ? 'Creating session' : 'Create session',
            icon: MessageSquarePlus,
            disabled: creatingSession,
            run: newChat,
          },
          {
            id: 'delete',
            label: 'Delete session',
            icon: Trash2,
            run: async () => {
              await client.session.delete({ sessionID: session.id });
              queryClient.setQueryData<Session[]>(queryKeys.sessions, (prev = []) => removeSession(prev, session.id));
              queryClient.removeQueries({ queryKey: queryKeys.sessionData(session.id) });
              editor.removeField(slotID);
            },
          },
        ],
        mount(container) {
          const root = createRoot(container);
          root.render(
            <QueryClientProvider client={queryClient}>
              <SessionPanel fixedSessionID={session.id} />
            </QueryClientProvider>,
          );
          return () => queueMicrotask(() => root.unmount());
        },
      });
    }

    for (const id of registeredSlotsRef.current) {
      if (!nextSlotIds.has(id)) editor.removeField(id);
    }
    registeredSlotsRef.current = nextSlotIds;

    return undefined;
  }, [client, creatingSession, editor, newChat, queryClient, sessions]);

  useEffect(() => () => {
    for (const id of registeredSlotsRef.current) editor.removeField(id);
    registeredSlotsRef.current.clear();
  }, [editor]);

  return err ? <div className="dc-controller-error">{err}</div> : null;
}

function ChatLoadingPanel() {
  return (
    <div className={`dc-root dc-root-slot dc-ui ${panelStyles.root}`}>
      <main className="dc-chat">
        <div className="dc-messages">
          <div className="dc-empty-state">
            <Loader2 className="spin" size={18} />
          </div>
        </div>
        <div className="dc-composer-shell">
          <div className="dc-composer">
            <textarea placeholder="Describe a change..." rows={2} disabled />
            <div className="dc-composer-toolbar">
              <IconButton title="Attach files" disabled>
                <ImagePlus size={15} />
              </IconButton>
              <ModelSelect value={modelValue(DEFAULT_MODEL_PROVIDER, DEFAULT_MODEL_ID)} onChange={() => undefined} models={[]} />
              <button className="dc-send" disabled>
                <Send size={14} />
                <span>Send</span>
              </button>
            </div>
          </div>
        </div>
        <ConnectionOverlay />
      </main>
    </div>
  );
}

function SessionPanel({ fixedSessionID }: { fixedSessionID: string }) {
  const client = useMemo(createClient, []);
  const queryClient = useQueryClient();
  const [sessionID, setSessionID] = useState<string | undefined>(fixedSessionID);
  const [selectedModel, setSelectedModel] = useState(modelValue(DEFAULT_MODEL_PROVIDER, DEFAULT_MODEL_ID));
  const [diffs, setDiffs] = useState<SnapshotFileDiff[]>([]);
  const [showDiff, setShowDiff] = useState(false);
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [running, setRunning] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ state: 'starting' });
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sessionIDRef = useRef<string | undefined>(undefined);
  sessionIDRef.current = sessionID;

  useEffect(() => {
    setSessionID(fixedSessionID);
    setDiffs([]);
    setShowDiff(false);
    setErr(null);
  }, [fixedSessionID]);

  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: async () => {
      const res = await client.session.list({ roots: true, limit: 80 });
      return sortSessions((res.data ?? []) as Session[]);
    },
  });
  const providersQuery = useQuery({
    queryKey: queryKeys.providers,
    queryFn: async () => normalizeProviderCatalog((await client.provider.list()).data),
  });
  const sessionDataQuery = useQuery({
    queryKey: sessionID ? queryKeys.sessionData(sessionID) : ['opencode', 'session', 'none'],
    enabled: !!sessionID,
    queryFn: async (): Promise<SessionData> => {
      const targetID = sessionID;
      if (!targetID) return { messages: [], questions: [], permissions: [], children: [] };
      const [msgRes, questionRes, permissionRes, childRes] = await Promise.all([
        client.session.messages({ sessionID: targetID }),
        client.question.list().catch(() => ({ data: [] })),
        client.permission.list().catch(() => ({ data: [] })),
        client.session.children({ sessionID: targetID }).catch(() => ({ data: [] })),
      ]);
      return {
        messages: (msgRes.data ?? []) as SessionMessage[],
        questions: ((questionRes.data ?? []) as QuestionRequest[]).filter((q) => q.sessionID === targetID),
        permissions: ((permissionRes.data ?? []) as PermissionRequest[]).filter((p) => p.sessionID === targetID),
        children: (childRes.data ?? []) as Session[],
      };
    },
  });

  const sessions = sessionsQuery.data ?? [];
  const providerCatalog = providersQuery.data ?? { providers: [], defaults: {}, connected: [] };
  const messages = sessionDataQuery.data?.messages ?? [];
  const pendingQuestions = sessionDataQuery.data?.questions ?? [];
  const pendingPermissions = sessionDataQuery.data?.permissions ?? [];
  const children = sessionDataQuery.data?.children ?? [];
  const modelChoices = useMemo(() => modelChoicesFromCatalog(providerCatalog), [providerCatalog]);
  const resolvedModel = useMemo(() => {
    if (modelChoices.some((m) => modelValue(m.providerID, m.modelID) === selectedModel)) {
      return splitModelValue(selectedModel);
    }
    return splitModelValue(preferredModelValue(providerCatalog));
  }, [modelChoices, providerCatalog, selectedModel]);
  const loading = sessionsQuery.isLoading || providersQuery.isLoading || (!!sessionID && sessionDataQuery.isLoading);
  const updateSessionData = useCallback(
    (targetID: string, updater: (data: SessionData) => SessionData) => {
      queryClient.setQueryData<SessionData>(
        queryKeys.sessionData(targetID),
        (current) => updater(current ?? { messages: [], questions: [], permissions: [], children: [] }),
      );
    },
    [queryClient],
  );
  const refreshSessionData = useCallback(
    async (targetID: string) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessionData(targetID) });
    },
    [queryClient],
  );
  const syncSessionMessages = useCallback(
    async (targetID: string) => {
      const res = await client.session.messages({ sessionID: targetID });
      if (!res.data) return;
      queryClient.setQueryData<SessionData>(
        queryKeys.sessionData(targetID),
        (current) => ({
          ...(current ?? { messages: [], questions: [], permissions: [], children: [] }),
          messages: reconcileSessionMessages(current?.messages ?? [], res.data as SessionMessage[]),
        }),
      );
    },
    [client, queryClient],
  );

  const selectSession = useCallback(
    (target: Session) => {
      setSessionID(target.id);
      setDiffs([]);
      setShowDiff(false);
      setErr(null);
    },
    [],
  );

  useEffect(() => {
    setSessionID(fixedSessionID);
  }, [fixedSessionID]);

  useEffect(() => {
    if (sessions.some((session) => session.id === fixedSessionID)) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
  }, [fixedSessionID, queryClient, sessions]);

  useEffect(() => {
    if (!sessionID) setSessionID(fixedSessionID);
  }, [fixedSessionID, sessionID]);

  useEffect(() => {
    if (modelChoices.length === 0) return;
    if (modelChoices.some((m) => modelValue(m.providerID, m.modelID) === selectedModel)) return;
    setSelectedModel(preferredModelValue(providerCatalog));
  }, [modelChoices, providerCatalog, selectedModel]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const res = await fetch('/__editor/ai/status');
        const status = (await res.json()) as AiStatus;
        if (!cancelled) setAiStatus(status);
      } catch (e) {
        if (!cancelled) setAiStatus({ state: 'error', message: (e as Error).message });
      }
    }
    void refresh();
    const id = window.setInterval(() => void refresh(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();

    (async () => {
      try {
        const subscription = await client.event.subscribe(undefined, {
          signal: ac.signal,
          onSseError: (error) => {
            if (!cancelled) {
              setConnected(false);
              setErr((error as Error).message);
            }
          },
        });
        setConnected(true);
        for await (const event of subscription.stream) {
          if (cancelled) break;
          handleEvent(event as Event, sessionIDRef.current);
        }
      } catch (e) {
        if (!ac.signal.aborted) setErr((e as Error).message);
      } finally {
        if (!cancelled) setConnected(false);
      }
    })();

    function handleEvent(ev: Event, currentID: string | undefined) {
      if (ev.type === 'message.updated') {
        updateSessionData(ev.properties.sessionID, (data) => ({
          ...data,
          messages: applyMessageUpdate(data.messages, ev.properties.info),
        }));
        return;
      }
      if (ev.type === 'message.part.updated') {
        updateSessionData(ev.properties.sessionID, (data) => ({
          ...data,
          messages: applyPartUpdate(data.messages, ev.properties.part),
        }));
        return;
      }
      if (ev.type === 'message.part.delta') {
        updateSessionData(ev.properties.sessionID, (data) => ({
          ...data,
          messages: applyPartDelta(data.messages, ev.properties),
        }));
        return;
      }
      if (ev.type === 'message.part.removed') {
        const { sessionID: sid, messageID, partID } = ev.properties;
        if (!messageID || !partID) return;
        updateSessionData(sid, (data) => ({
          ...data,
          messages: applyPartRemoved(data.messages, messageID, partID),
        }));
        return;
      }
      if (ev.type === 'session.created' || ev.type === 'session.updated') {
        queryClient.setQueryData<Session[]>(queryKeys.sessions, (prev = []) => mergeSessions(prev, ev.properties.info));
        return;
      }
      if (ev.type === 'session.deleted') {
        queryClient.setQueryData<Session[]>(queryKeys.sessions, (prev = []) => removeSession(prev, ev.properties.sessionID));
        return;
      }
      if (ev.type === 'session.status') {
        if (ev.properties.sessionID !== currentID) return;
        setRunning(ev.properties.status.type === 'busy' || ev.properties.status.type === 'retry');
        return;
      }
      if (ev.type === 'session.idle') {
        if (ev.properties.sessionID === currentID) {
          setRunning(false);
          void refreshSessionData(ev.properties.sessionID);
        }
        return;
      }
      if (ev.type === 'session.error') {
        if (ev.properties.sessionID && ev.properties.sessionID !== currentID) return;
        const message = ev.properties.error?.data && 'message' in ev.properties.error.data
          ? String(ev.properties.error.data.message)
          : ev.properties.error?.name ?? 'session error';
        setErr(message);
        setRunning(false);
        if (ev.properties.sessionID) void refreshSessionData(ev.properties.sessionID);
        return;
      }
      if (ev.type === 'question.asked') {
        const req = ev.properties;
        updateSessionData(req.sessionID, (data) => ({
          ...data,
          questions: upsertByID(data.questions, req),
        }));
        return;
      }
      if (ev.type === 'question.replied' || ev.type === 'question.rejected') {
        const { sessionID: sid, requestID } = ev.properties;
        updateSessionData(sid, (data) => ({
          ...data,
          questions: removeByID(data.questions, requestID),
        }));
        return;
      }
      if (ev.type === 'permission.asked') {
        const req = ev.properties;
        updateSessionData(req.sessionID, (data) => ({
          ...data,
          permissions: upsertByID(data.permissions, req),
        }));
        return;
      }
      if (ev.type === 'permission.replied') {
        updateSessionData(ev.properties.sessionID, (data) => ({
          ...data,
          permissions: removeByID(data.permissions, ev.properties.requestID),
        }));
      }
    }

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [client, queryClient, refreshSessionData, updateSessionData]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [messages, pendingQuestions, pendingPermissions]);

  const send = useCallback(
    async (text: string) => {
      if (!sessionID || (!text.trim() && attachments.length === 0)) return;
      const parts = [
        ...(text.trim() ? [{ type: 'text' as const, text: text.trim() }] : []),
        ...attachments.map(({ localID, ...part }) => part),
      ];
      updateSessionData(sessionID, (data) => ({
        ...data,
        messages: appendOptimisticUserMessage(
          data.messages,
          createOptimisticUserMessage(sessionID, parts, resolvedModel),
        ),
      }));
      setInput('');
      setAttachments([]);
      setRunning(true);
      setErr(null);
      try {
        await client.session.promptAsync({
          sessionID,
          model: resolvedModel,
          parts,
        });
        await syncSessionMessages(sessionID);
      } catch (e) {
        setErr((e as Error).message);
        setRunning(false);
        await syncSessionMessages(sessionID);
      }
    },
    [attachments, client, resolvedModel, sessionID, syncSessionMessages, updateSessionData],
  );

  const attachFiles = useCallback(async (files: FileList | File[]) => {
    try {
      const next = await Promise.all(Array.from(files).map(fileToPart));
      setAttachments((prev) => [...prev, ...next]);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  const answerQuestion = useCallback(
    async (requestID: string, answers: string[][]) => {
      try {
        await client.question.reply({ requestID, answers });
        if (sessionID) {
          updateSessionData(sessionID, (data) => ({
            ...data,
            questions: removeByID(data.questions, requestID),
          }));
        }
      } catch (e) {
        setErr((e as Error).message);
      }
    },
    [client, sessionID, updateSessionData],
  );

  const rejectQuestion = useCallback(
    async (requestID: string) => {
      try {
        await client.question.reject({ requestID });
        if (sessionID) {
          updateSessionData(sessionID, (data) => ({
            ...data,
            questions: removeByID(data.questions, requestID),
          }));
        }
      } catch (e) {
        setErr((e as Error).message);
      }
    },
    [client, sessionID, updateSessionData],
  );

  const replyPermission = useCallback(
    async (requestID: string, reply: 'once' | 'always' | 'reject') => {
      try {
        await client.permission.reply({ requestID, reply });
        if (sessionID) {
          updateSessionData(sessionID, (data) => ({
            ...data,
            permissions: removeByID(data.permissions, requestID),
          }));
        }
      } catch (e) {
        setErr((e as Error).message);
      }
    },
    [client, sessionID, updateSessionData],
  );

  const loadDiff = useCallback(
    async (messageID?: string) => {
      if (!sessionID) return;
      try {
        const res = await client.session.diff({ sessionID, messageID });
        setDiffs((res.data ?? []) as SnapshotFileDiff[]);
        setShowDiff(true);
      } catch (e) {
        setErr((e as Error).message);
      }
    },
    [client, sessionID],
  );

  const revertMessage = useCallback(
    async (messageID: string) => {
      if (!sessionID) return;
      try {
        await client.session.revert({ sessionID, messageID });
        await queryClient.invalidateQueries({ queryKey: queryKeys.sessionData(sessionID) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      } catch (e) {
        setErr((e as Error).message);
      }
    },
    [client, queryClient, sessionID],
  );

  const forkMessage = useCallback(
    async (messageID: string) => {
      if (!sessionID) return;
      try {
        const res = await client.session.fork({ sessionID, messageID });
        if (res.data) {
          const forked = res.data as Session;
          queryClient.setQueryData<Session[]>(queryKeys.sessions, (prev = []) => mergeSessions(prev, forked));
          selectSession(forked);
        }
      } catch (e) {
        setErr((e as Error).message);
      }
    },
    [client, queryClient, selectSession, sessionID],
  );

  const deleteMessage = useCallback(
    async (messageID: string) => {
      if (!sessionID) return;
      try {
        await client.session.deleteMessage({ sessionID, messageID });
        updateSessionData(sessionID, (data) => ({
          ...data,
          messages: data.messages.filter((m) => m.info.id !== messageID),
        }));
      } catch (e) {
        setErr((e as Error).message);
      }
    },
    [client, sessionID, updateSessionData],
  );

  const connectionError = aiStatus.state === 'error' || aiStatus.state === 'disabled';
  const connecting = !connectionError && (aiStatus.state !== 'ready' || !connected || loading);
  const canSend = !!sessionID && connected && aiStatus.state === 'ready' && !running && (!!input.trim() || attachments.length > 0);

  return (
    <div className={`dc-root dc-root-slot dc-ui ${panelStyles.root}`}>
      <main className="dc-chat">
        {children.length > 0 && (
          <div className="dc-child-strip">
            <GitBranch size={13} />
            {children.map((child) => (
              <button key={child.id} onClick={() => void selectSession(child)}>{compactTitle(child)}</button>
            ))}
          </div>
        )}

        {showDiff && (
          <DiffPanel diffs={diffs} onClose={() => setShowDiff(false)} />
        )}

        <div
          className="dc-messages"
          ref={scrollerRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length) void attachFiles(e.dataTransfer.files);
          }}
        >
          {loading && (
            <div className="dc-empty-state">
              <Loader2 className="spin" size={18} />
              <span>Loading session...</span>
            </div>
          )}

          {!loading && messages.length === 0 && pendingQuestions.length === 0 && pendingPermissions.length === 0 && (
            <div className="dc-empty-card">
              <Bot size={18} />
              <div>
                <div className="dc-empty-title">Ready when you are.</div>
                <p>Ask for a change, attach an image, or run an OpenCode command.</p>
              </div>
            </div>
          )}

          {err && (
            <div className="dc-alert">
              <span>{err}</span>
              <button onClick={() => setErr(null)}><X size={13} /></button>
            </div>
          )}

          {connectionError && aiStatus.message && (
            <div className="dc-alert">
              <span>{aiStatus.message}</span>
            </div>
          )}

          {pendingPermissions.map((permission) => (
            <PermissionCard key={permission.id} request={permission} onReply={replyPermission} />
          ))}

          {messages.map((m) => (
            <MessageView
              key={m.info.id}
              message={m}
              pendingQuestions={pendingQuestions}
              onAnswer={answerQuestion}
              onReject={rejectQuestion}
              onDiff={loadDiff}
              onRevert={revertMessage}
              onFork={forkMessage}
              onDelete={deleteMessage}
            />
          ))}
        </div>

        <div className="dc-composer-shell">
          {attachments.length > 0 && (
            <div className="dc-attachments">
              {attachments.map((file) => (
                <div key={file.localID} className="dc-attachment">
                  {file.mime.startsWith('image/') ? <img src={file.url} alt="" /> : <FileText size={14} />}
                  <span>{file.filename ?? file.mime}</span>
                  <button onClick={() => setAttachments((prev) => prev.filter((f) => f.localID !== file.localID))}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="dc-composer">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              accept="image/*,.txt,.md,.json,.pdf"
              onChange={(e) => {
                if (e.target.files) void attachFiles(e.target.files);
                e.currentTarget.value = '';
              }}
            />
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files);
                if (files.length) void attachFiles(files);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder="Describe a change..."
              rows={2}
            />
            <div className="dc-composer-toolbar">
              <IconButton title="Attach files" onClick={() => fileInputRef.current?.click()}>
                <ImagePlus size={15} />
              </IconButton>
              <ModelSelect value={selectedModel} onChange={setSelectedModel} models={modelChoices} />
              <button className="dc-send" onClick={() => void send(input)} disabled={!canSend}>
                {running ? <Loader2 className="spin" size={14} /> : <Send size={14} />}
                <span>Send</span>
              </button>
            </div>
          </div>
        </div>
        {connecting && <ConnectionOverlay />}
      </main>
    </div>
  );
}

function ConnectionOverlay() {
  return (
    <div className="dc-connection-overlay" role="status" aria-label="Connecting chat">
      <div className="dc-connection-card">
        <Loader2 className="spin" size={20} />
      </div>
    </div>
  );
}

function IconButton({ title, onClick, disabled, children }: {
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button className="dc-icon-button" title={title} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function ModelSelect({ value, onChange, models }: {
  value: string;
  onChange: (value: string) => void;
  models: ModelChoice[];
}) {
  return (
    <label className="dc-model-select" title="Model">
      <span>Model</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {models.length === 0 && <option value={value}>OpenCode / Big Pickle</option>}
        {models.map((model) => (
          <option key={modelValue(model.providerID, model.modelID)} value={modelValue(model.providerID, model.modelID)}>
            {model.label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} />
    </label>
  );
}

function DiffPanel({ diffs, onClose }: { diffs: SnapshotFileDiff[]; onClose: () => void }) {
  return (
    <div className="dc-diff-panel">
      <div className="dc-diff-head">
        <div>
          <strong>Workspace diff</strong>
          <span>{diffs.length} file{diffs.length === 1 ? '' : 's'}</span>
        </div>
        <IconButton title="Close diff" onClick={onClose}><X size={14} /></IconButton>
      </div>
      {diffs.length === 0 ? (
        <div className="dc-diff-empty">No file changes in this session.</div>
      ) : (
        <div className="dc-diff-list">
          {diffs.map((diff) => (
            <details key={diff.file} className="dc-diff-file">
              <summary>
                <code>{diff.file}</code>
                <span>+{diff.additions} -{diff.deletions}</span>
              </summary>
              <pre>{diff.patch}</pre>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

interface MessageViewProps {
  message: SessionMessage;
  pendingQuestions: QuestionRequest[];
  onAnswer: (requestID: string, answers: string[][]) => Promise<void>;
  onReject: (requestID: string) => Promise<void>;
  onDiff: (messageID?: string) => Promise<void>;
  onRevert: (messageID: string) => Promise<void>;
  onFork: (messageID: string) => Promise<void>;
  onDelete: (messageID: string) => Promise<void>;
}

function MessageView({ message, pendingQuestions, onAnswer, onReject, onDiff, onRevert, onFork, onDelete }: MessageViewProps) {
  const role = message.info.role;
  return (
    <article className={`dc-message dc-role-${role}`}>
      <header className="dc-message-head">
        <div className="dc-message-role">{role}</div>
        <div className="dc-message-actions">
          <button onClick={() => void onDiff(message.info.id)}>Diff</button>
          <button onClick={() => void onFork(message.info.id)}>Fork</button>
          <button onClick={() => void onRevert(message.info.id)}><RotateCcw size={12} /> Revert</button>
          <button onClick={() => void onDelete(message.info.id)}><Trash2 size={12} /></button>
        </div>
      </header>
      <div className="dc-message-body">
        {message.parts.map((part, i) => (
          <PartView
            key={part.id ?? i}
            part={part}
            role={role}
            pendingQuestions={pendingQuestions}
            onAnswer={onAnswer}
            onReject={onReject}
          />
        ))}
      </div>
    </article>
  );
}

interface PartViewProps {
  part: Part;
  role: string;
  pendingQuestions: QuestionRequest[];
  onAnswer: (requestID: string, answers: string[][]) => Promise<void>;
  onReject: (requestID: string) => Promise<void>;
}

function PartView({ part, role, pendingQuestions, onAnswer, onReject }: PartViewProps) {
  const p = part as Part & { [key: string]: any };
  if (p.type === 'text') {
    if (role === 'user') return <div className="dc-text dc-text-plain">{p.text}</div>;
    return <Markdown source={p.text} />;
  }
  if (p.type === 'reasoning') {
    return (
      <details className="dc-reasoning">
        <summary>Reasoning</summary>
        <Markdown source={p.text ?? ''} />
      </details>
    );
  }
  if (p.type === 'file') {
    return <FilePartView part={p} />;
  }
  if (p.type === 'tool') {
    return (
      <ToolPartView
        part={p}
        pendingQuestions={pendingQuestions}
        onAnswer={onAnswer}
        onReject={onReject}
      />
    );
  }
  if (p.type === 'patch') {
    const patchText = Array.isArray(p.files)
      ? p.files.map((f: string | SnapshotFileDiff) => typeof f === 'string' ? f : f.patch).join('\n\n')
      : String(p.patch ?? '');
    return <pre className="dc-code">{patchText}</pre>;
  }
  return null;
}

function FilePartView({ part }: { part: any }) {
  const name = part.filename ?? part.mime ?? 'attachment';
  if (typeof part.mime === 'string' && part.mime.startsWith('image/') && part.url) {
    return (
      <figure className="dc-file-preview">
        <img src={part.url} alt={name} />
        <figcaption>{name}</figcaption>
      </figure>
    );
  }
  return (
    <div className="dc-file">
      <FileText size={14} />
      <code>{name}</code>
    </div>
  );
}

function ToolPartView({ part, pendingQuestions, onAnswer, onReject }: {
  part: any;
  pendingQuestions: QuestionRequest[];
  onAnswer: (requestID: string, answers: string[][]) => Promise<void>;
  onReject: (requestID: string) => Promise<void>;
}) {
  const toolName: string = part.tool;
  const status: string = part.state?.status ?? 'pending';
  const input = part.state?.input ?? {};
  const output = part.state?.output ?? part.state?.error;

  if (toolName === 'question' && status === 'running') {
    const req = pendingQuestions.find((q) => q.tool?.callID === part.callID || q.tool?.messageID === part.messageID);
    if (req) return <QuestionForm request={req} onAnswer={onAnswer} onReject={onReject} />;
  }

  if (toolName === 'todowrite') {
    const todos = (input.todos ?? []) as Todo[];
    return <TodoBlock todos={todos} />;
  }

  if (toolName === 'bash') {
    return (
      <details className="dc-tool-block">
        <summary>
          <code>bash</code>
          <span className={`dc-badge dc-badge-${status}`}>{status}</span>
          {input.description && <span className="dc-tool-desc">{String(input.description)}</span>}
        </summary>
        {input.command && <pre className="dc-code">$ {String(input.command)}</pre>}
        {output && <pre className="dc-code dc-code-output">{String(output)}</pre>}
      </details>
    );
  }

  const label = input.path ?? input.filePath ?? input.file_path ?? input.pattern ?? input.query ?? '';
  return (
    <div className={`dc-tool dc-tool-${status}`}>
      <code>{toolName}</code>
      {label && <span className="dc-tool-path">{String(label)}</span>}
      <span className={`dc-badge dc-badge-${status}`}>{status}</span>
    </div>
  );
}

function TodoBlock({ todos }: { todos: Todo[] }) {
  return (
    <div className="dc-todos">
      {todos.map((t, i) => (
        <div key={i} className={`dc-todo dc-todo-${t.status}`}>
          <span className="dc-todo-check">{t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '...' : '○'}</span>
          <span className="dc-todo-text">{t.content}</span>
        </div>
      ))}
    </div>
  );
}

function PermissionCard({ request, onReply }: {
  request: PermissionRequest;
  onReply: (requestID: string, reply: 'once' | 'always' | 'reject') => Promise<void>;
}) {
  return (
    <div className="dc-question dc-permission">
      <div>
        <div className="dc-question-prompt">Permission requested</div>
        <p>{request.permission}</p>
      </div>
      {request.patterns.length > 0 && (
        <div className="dc-permission-patterns">
          {request.patterns.map((pattern) => <code key={pattern}>{pattern}</code>)}
        </div>
      )}
      <div className="dc-question-actions">
        <button onClick={() => void onReply(request.id, 'once')}>Allow once</button>
        {request.always.length > 0 && <button onClick={() => void onReply(request.id, 'always')}>Always allow</button>}
        <button className="dc-question-reject" onClick={() => void onReply(request.id, 'reject')}>Reject</button>
      </div>
    </div>
  );
}

function QuestionForm({
  request,
  onAnswer,
  onReject,
}: {
  request: QuestionRequest;
  onAnswer: (requestID: string, answers: string[][]) => Promise<void>;
  onReject: (requestID: string) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<string[][]>(() => request.questions.map(() => []));
  const [customs, setCustoms] = useState<string[]>(() => request.questions.map(() => ''));
  const [submitting, setSubmitting] = useState(false);

  const toggle = (qi: number, option: string, multiple: boolean) => {
    setAnswers((prev) => {
      const next = prev.slice();
      const curr = next[qi] ?? [];
      next[qi] = multiple
        ? curr.includes(option) ? curr.filter((o) => o !== option) : [...curr, option]
        : curr.includes(option) ? [] : [option];
      return next;
    });
  };

  const submit = async () => {
    setSubmitting(true);
    const final = request.questions.map((q, i) => {
      const selected = answers[i] ?? [];
      const custom = (customs[i] ?? '').trim();
      if (custom && q.custom !== false) return [...selected, custom];
      return selected;
    });
    try {
      await onAnswer(request.id, final);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dc-question">
      {request.questions.map((q, qi) => (
        <div key={qi} className="dc-question-block">
          <div className="dc-question-prompt">{q.question}</div>
          <div className="dc-question-options">
            {q.options.map((opt) => {
              const selected = (answers[qi] ?? []).includes(opt.label);
              return (
                <label key={opt.label} className={`dc-option ${selected ? 'selected' : ''}`}>
                  <input
                    type={q.multiple ? 'checkbox' : 'radio'}
                    name={`q-${request.id}-${qi}`}
                    checked={selected}
                    onChange={() => toggle(qi, opt.label, !!q.multiple)}
                  />
                  <span>{opt.label}</span>
                  {opt.description && <small className="dc-option-desc">{opt.description}</small>}
                </label>
              );
            })}
          </div>
          {q.custom !== false && (
            <input
              className="dc-question-custom"
              placeholder="Type a custom answer..."
              value={customs[qi] ?? ''}
              onChange={(e) => setCustoms((prev) => prev.map((v, i) => (i === qi ? e.target.value : v)))}
            />
          )}
        </div>
      ))}
      <div className="dc-question-actions">
        <button onClick={submit} disabled={submitting}>Send answer</button>
        <button className="dc-question-reject" onClick={() => void onReject(request.id)} disabled={submitting}>Skip</button>
      </div>
    </div>
  );
}

function Markdown({ source }: { source: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return <div className="dc-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}
