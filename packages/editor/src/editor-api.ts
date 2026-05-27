import { ORPCError, os } from '@orpc/server';
import { z } from 'zod';
import type { JsonValue, ListPublicFilesResponse, PublicFile, UploadPublicFileResponse } from './rpc';

export const EDITOR_API_PATH = '/editor-api';
export const EDITOR_OPENCODE_PATH = '/editor-api/opencode';

export interface AuthoredValueCommitInput {
  id: string;
  value?: JsonValue;
  code?: string;
}

export interface PublicFileUploadInput {
  fileName: string;
  contentType: string;
  dataBase64: string;
}

export interface EditorApiContext {
  commitAuthoredValue(input: AuthoredValueCommitInput): Promise<object> | object;
  listPublicFiles(): Promise<ListPublicFilesResponse> | ListPublicFilesResponse;
  uploadPublicFile(input: PublicFileUploadInput): Promise<UploadPublicFileResponse> | UploadPublicFileResponse;
}

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(),
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]));

const authoredValueCommitInput = z.object({
  id: z.string().min(1),
  value: jsonValueSchema.optional(),
  code: z.string().optional(),
}).refine((input) => input.value !== undefined || input.code !== undefined, {
  message: 'Expected either value or code.',
});

const publicFileUploadInput = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  dataBase64: z.string(),
});

function assertListPublicFilesResponse(value: ListPublicFilesResponse): ListPublicFilesResponse {
  if (!Array.isArray(value.files)) throw new ORPCError('INTERNAL_SERVER_ERROR');
  for (const file of value.files as PublicFile[]) {
    if (
      typeof file.fileName !== 'string'
      || typeof file.url !== 'string'
      || typeof file.size !== 'number'
      || typeof file.mtimeMs !== 'number'
    ) {
      throw new ORPCError('INTERNAL_SERVER_ERROR');
    }
  }
  return value;
}

const base = os.$context<EditorApiContext>();

export const editorApiRouter = {
  authoredValues: {
    commit: base
      .input(authoredValueCommitInput)
      .handler(({ context, input }) => context.commitAuthoredValue(input)),
  },
  publicFiles: {
    list: base.handler(async ({ context }) => assertListPublicFilesResponse(await context.listPublicFiles())),
    upload: base
      .input(publicFileUploadInput)
      .handler(({ context, input }) => context.uploadPublicFile(input)),
  },
};

export type EditorApiRouter = typeof editorApiRouter;
