/**
 * @module replies/use-replies
 *
 * TanStack Query hooks for one issue's discussion, its reply draft, and the
 * user's saved replies.
 *
 * Three shapes of state live here and each one fails differently, so each one
 * is handled differently.
 *
 * The discussion is read-only history. It is fetched per issue, never with the
 * queue, and it is not polled: a comment appears only when somebody writes one,
 * and the writer is usually the person reading this pane.
 *
 * The draft is the user's work in progress. It is saved with the version the
 * editor last read, so a second tab is told about the collision instead of
 * silently losing text. A refused save keeps the typed text in the component
 * and is retried on the next edit; nothing here deletes what the user wrote.
 *
 * The send is the only irreversible act in the app. The server records an
 * attempt before it calls the provider, and a request whose outcome is unknown
 * comes back with `unconfirmed: true`. That response must not read like a
 * failure and must not offer a retry, so it is surfaced as a distinct error
 * type carrying the server's own sentence.
 */
"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { readApiError } from "@/features/presets/api-error";
import { devComments, devSavedReplies, readDataMode } from "@/features/dev-tools/data-mode";
import type { IssueWithTriage } from "@/features/inbox/use-issues";

/** The issue fields the reply surface reads. */
export type ReplyIssue = Pick<IssueWithTriage, "id" | "url" | "provider">;

/** One comment as `GET /api/issues/:id/comments` returns it. */
export interface ReplyComment {
  id: string;
  body: string;
  author: string | null;
  authorAvatar: string | null;
  createdAt: string;
  updatedAt: string;
  /** A provider-generated record (a label change, a close, a reference). */
  isSystem: boolean;
  url: string | null;
}

/** One page of discussion, oldest first, plus the cursor that walks back. */
export interface CommentsPage {
  comments: ReplyComment[];
  olderCursor: string | null;
  /**
   * `false` when the provider implements no comment API at all. That is a
   * different fact from an empty thread and the pane renders it differently.
   */
  supported: boolean;
}

/** The stored draft for one issue. */
export interface ReplyDraft {
  id: string;
  body: string;
  version: number;
  /** Set while a send's outcome is unknown; Send is withheld until it clears. */
  sendAttemptedAt: string | null;
  updatedAt: string;
}

/** A personal reply template. */
export interface SavedReply {
  id: string;
  name: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

/** Body of `PUT /api/issues/:id/draft`. */
export interface SaveDraftInput {
  body: string;
  expectedVersion: number;
}

/** Body of `POST /api/saved-replies`. */
export interface CreateSavedReplyInput {
  name: string;
  body: string;
}

/** Body of `PATCH /api/saved-replies/:id`. */
export interface UpdateSavedReplyInput {
  id: string;
  name?: string;
  body?: string;
}

/** The success payload of `POST /api/issues/:id/replies`. */
export interface PostedReply {
  ok: true;
  comment: ReplyComment;
}

/**
 * A save refused because the draft moved on somewhere else.
 *
 * The status matters, not just the sentence: a conflict is resolved by
 * reloading the stored draft, while any other failure is resolved by trying
 * again. Collapsing both into one `Error` would make the composer retry into
 * the same 409 forever.
 */
export class DraftConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftConflictError";
  }
}

/**
 * A send whose outcome the server could not confirm.
 *
 * Deliberately not a plain failure. The comment may be published, so the
 * composer withholds Send and the message tells the user to check the issue
 * rather than to try again.
 */
export class UnconfirmedSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnconfirmedSendError";
  }
}

/** Page size requested from the comments route; its own default and maximum agree. */
export const COMMENTS_PAGE_SIZE = 30;

/**
 * Read one page of a fixture thread.
 *
 * The fixtures return the whole thread, so the cursor here is a plain index.
 * Paging them rather than dumping them in one page keeps the "Older comments"
 * control reachable in the dev harness, which is the only place a thousand
 * comment thread exists.
 *
 * @param thread - The fixture thread, oldest first.
 * @param cursor - The index of the end of the page, or `null` for the newest page.
 */
function fixturePage(thread: ReplyComment[], cursor: string | null): CommentsPage {
  const requested = Number(cursor);
  const end =
    Number.isFinite(requested) && requested > 0
      ? Math.min(requested, thread.length)
      : thread.length;
  const start = Math.max(0, end - COMMENTS_PAGE_SIZE);
  return {
    comments: thread.slice(start, end),
    olderCursor: start > 0 ? String(start) : null,
    supported: true,
  };
}

/**
 * Fetches one page of discussion.
 *
 * @param issueId - The issue whose comments are being read.
 * @param cursor - The cursor from the previous page, or `null` for the newest.
 * @returns The page, or the provider's own refusal sentence.
 */
async function fetchCommentPage(issueId: string, cursor: string | null): Promise<CommentsPage> {
  const fixture = await devComments(readDataMode());
  if (fixture) return fixturePage(fixture, cursor);

  const params = new URLSearchParams({ limit: String(COMMENTS_PAGE_SIZE) });
  if (cursor) params.set("cursor", cursor);

  const res = await fetch(`/api/issues/${issueId}/comments?${params}`);
  if (!res.ok)
    throw new Error(await readApiError(res, "Could not load this discussion right now."));
  return res.json();
}

/**
 * Lists an issue's discussion one page at a time, newest page first.
 *
 * `getNextPageParam` hands back the server's cursor untouched: the adapters
 * normalise GitHub's ascending paging and GitLab's descending paging into one
 * direction, and re-deriving it here would undo that.
 *
 * @param issueId - The issue to read, or `undefined` when none is selected.
 * @param open - Whether the pane is actually showing the discussion.
 * @returns A TanStack infinite query of {@link CommentsPage}.
 */
export function useComments(issueId: string | undefined, open: boolean) {
  return useInfiniteQuery({
    queryKey: ["comments", issueId],
    enabled: open && !!issueId,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchCommentPage(issueId as string, pageParam),
    getNextPageParam: (lastPage: CommentsPage) => lastPage.olderCursor,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Reads the user's draft for one issue.
 *
 * @param issueId - The issue, or `undefined` when none is selected.
 * @returns A TanStack query of {@link ReplyDraft} or `null`.
 */
export function useDraft(issueId: string | undefined) {
  return useQuery<ReplyDraft | null>({
    queryKey: ["draft", issueId],
    enabled: !!issueId,
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/draft`);
      if (!res.ok) throw new Error(await readApiError(res, "Could not load this draft"));
      return res.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Saves the draft conditionally on the version the editor read.
 *
 * There is no toast here on purpose. This runs from a debounce while somebody
 * is typing, and a toast per failed keystroke would bury the sentence that
 * matters. The composer decides instead: a conflict becomes a persistent
 * banner with a reload action, and anything else becomes a quiet line saying
 * the text is still held locally.
 *
 * @param issueId - The issue the draft belongs to.
 * @returns A TanStack mutation; `mutate` accepts a {@link SaveDraftInput}.
 */
export function useSaveDraft(issueId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<ReplyDraft, Error, SaveDraftInput>({
    mutationFn: async ({ body, expectedVersion }) => {
      if (!issueId) throw new Error("No issue selected");
      const res = await fetch(`/api/issues/${issueId}/draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, expectedVersion }),
      });
      if (res.status === 409) {
        throw new DraftConflictError(
          await readApiError(res, "This draft changed somewhere else. Reload it before saving.")
        );
      }
      if (!res.ok) throw new Error(await readApiError(res, "Failed to save the draft"));
      return res.json();
    },
    onSuccess: (draft) => {
      queryClient.setQueryData(["draft", issueId], draft);
    },
  });
}

/**
 * Discards the stored draft.
 *
 * @param issueId - The issue whose draft is removed.
 * @returns A TanStack mutation.
 */
export function useDiscardDraft(issueId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<{ ok: true }, Error, void>({
    mutationFn: async () => {
      if (!issueId) throw new Error("No issue selected");
      const res = await fetch(`/api/issues/${issueId}/draft`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readApiError(res, "Failed to discard the draft"));
      return res.json();
    },
    onSuccess: () => {
      queryClient.setQueryData(["draft", issueId], null);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
}

/**
 * Reads the reply failure and whether the comment may already exist.
 *
 * `readApiError` returns only the sentence, and this response carries the
 * `unconfirmed` flag in the same body, so one parse has to produce both.
 *
 * @param res - The failed send response.
 * @returns The server's sentence and whether the outcome is unknown.
 */
async function readSendFailure(res: Response): Promise<{ message: string; unconfirmed: boolean }> {
  try {
    const body = (await res.json()) as { error?: unknown; unconfirmed?: unknown };
    return {
      message:
        typeof body.error === "string" && body.error.trim().length > 0
          ? body.error
          : "Failed to post the reply",
      unconfirmed: body.unconfirmed === true,
    };
  } catch {
    return { message: "Failed to post the reply", unconfirmed: false };
  }
}

/**
 * Publishes the draft as an issue comment.
 *
 * On success the draft is cleared rather than invalidated: the server deleted
 * it, and a refetch would only race the next keystroke. On an unconfirmed
 * failure the draft is refetched, because `sendAttemptedAt` is what flips the
 * composer into the state that withholds Send.
 *
 * @param issueId - The issue being replied to.
 * @returns A TanStack mutation; `mutate` accepts the comment body.
 */
export function useSendReply(issueId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<PostedReply, Error, string>({
    mutationFn: async (body) => {
      if (!issueId) throw new Error("No issue selected");
      const res = await fetch(`/api/issues/${issueId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const failure = await readSendFailure(res);
        throw failure.unconfirmed
          ? new UnconfirmedSendError(failure.message)
          : new Error(failure.message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.setQueryData(["draft", issueId], null);
      queryClient.invalidateQueries({ queryKey: ["comments", issueId] });
    },
    onError: (error) => {
      toast.error(error.message);
      queryClient.invalidateQueries({ queryKey: ["draft", issueId] });
    },
  });
}

/**
 * Lists the user's saved reply templates.
 *
 * @returns A TanStack query of {@link SavedReply}.
 */
export function useSavedReplies() {
  return useQuery<SavedReply[]>({
    queryKey: ["saved-replies"],
    queryFn: async () => {
      const fixture = await devSavedReplies(readDataMode());
      if (fixture) return fixture;
      const res = await fetch("/api/saved-replies");
      if (!res.ok) throw new Error(await readApiError(res, "Failed to fetch saved replies"));
      return res.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Creates a saved reply template.
 *
 * @returns A TanStack mutation; `mutate` accepts a {@link CreateSavedReplyInput}.
 */
export function useCreateSavedReply() {
  const queryClient = useQueryClient();

  return useMutation<SavedReply, Error, CreateSavedReplyInput>({
    mutationFn: async ({ name, body }) => {
      const res = await fetch("/api/saved-replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, body }),
      });
      if (!res.ok) throw new Error(await readApiError(res, "Failed to save the reply"));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-replies"] });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
}

/**
 * Rewrites a saved reply template.
 *
 * @returns A TanStack mutation; `mutate` accepts an {@link UpdateSavedReplyInput}.
 */
export function useUpdateSavedReply() {
  const queryClient = useQueryClient();

  return useMutation<SavedReply, Error, UpdateSavedReplyInput>({
    mutationFn: async ({ id, name, body }) => {
      const res = await fetch(`/api/saved-replies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, body }),
      });
      if (!res.ok) throw new Error(await readApiError(res, "Failed to update the reply"));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-replies"] });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
}

/**
 * Deletes a saved reply template. Comments already sent from it are unaffected.
 *
 * @returns A TanStack mutation; `mutate` accepts the template id.
 */
export function useDeleteSavedReply() {
  const queryClient = useQueryClient();

  return useMutation<{ ok: true }, Error, string>({
    mutationFn: async (id) => {
      const res = await fetch(`/api/saved-replies/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readApiError(res, "Failed to delete the reply"));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-replies"] });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
}
