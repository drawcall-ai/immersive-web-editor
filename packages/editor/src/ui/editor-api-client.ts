import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { RouterClient } from '@orpc/server';
import type { EditorApiRouter } from '../editor-api';

export type EditorApiClient = RouterClient<EditorApiRouter>;

export function createEditorApiClient(url: string): EditorApiClient {
  return createORPCClient<EditorApiClient>(new RPCLink({
    url: new URL(url, window.location.href).href,
    fetch: (request, init) => fetch(request, { ...init, credentials: 'include' }),
  }));
}
