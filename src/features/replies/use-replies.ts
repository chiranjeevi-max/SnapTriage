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
  /**
   * Which attempt holds the claim.
   *
   * Sent back when reconciling so the release targets the attempt this tab is
   * showing. A tab whose view was superseded must not release a newer one.
   */
  sendClaimId: string | null;
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

  return useMutation<{ ok: true }, Error, { expectedVersion?: number } | void>({
    mutationFn: async (input) => {
      if (!issueId) throw new Error("No issue selected");
      // The version this tab has seen. Without it, a tab left open on an older
      // draft could discard one another tab has since written.
      const version = input && "expectedVersion" in input ? input.expectedVersion : undefined;
      const query = version === undefined ? "" : `?version=${version}`;
      const res = await fetch(`/api/issues/${issueId}/draft${query}`, { method: "DELETE" });
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
      // A 5xx is never a definitive rejection, whatever the body says. A gateway
      // can swallow the `unconfirmed` flag, and treating that as a refusal drops
      // the guard on a comment the provider may already have published.
      unconfirmed: body.unconfirmed === true || res.status >= 500,
    };
  } catch {
    // An unreadable body is not evidence the send failed. A proxy can return an
    // HTML 502 after the server published the comment and deleted the draft, so
    // treating this as an ordinary failure re-enables Send on a reply that is
    // already public. Only a parsed response can report a definite rejection.
    return {
      message:
        "The reply may already be posted. Check the issue before sending again; your draft has been kept.",
      unconfirmed: true,
    };
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
 * A rejected `fetch` or an unparseable body is treated as unconfirmed rather
 * than as a failure. Both mean the request left this tab and no answer came
 * back, which is exactly the state where the provider may have accepted the
 * comment. Reporting them as failures would re-enable Send on a reply that may
 * already be public.
 *
 * @param issueId - The issue being replied to.
 * @returns A TanStack mutation; `mutate` accepts a {@link SendReplyInput}.
 */
export interface SendReplyInput {
  body: string;
  expectedVersion?: number;
}

export function useSendReply(issueId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<PostedReply, Error, SendReplyInput>({
    mutationFn: async ({ body, expectedVersion }) => {
      if (!issueId) throw new Error("No issue selected");

      let res: Response;
      try {
        res = await fetch(`/api/issues/${issueId}/replies`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body, expectedVersion }),
        });
      } catch {
        throw new UnconfirmedSendError(
          "The reply could not be sent and may not have been posted. Check the issue before sending again."
        );
      }

      if (!res.ok) {
        const failure = await readSendFailure(res);
        throw failure.unconfirmed
          ? new UnconfirmedSendError(failure.message)
          : new Error(failure.message);
      }

      try {
        return await res.json();
      } catch {
        // The provider answered, so the comment is very likely posted, but the
        // body did not survive. Keep the draft unconfirmed rather than inviting
        // a second public reply.
        throw new UnconfirmedSendError(
          "The reply was sent but its result could not be read. Check the issue before sending again."
        );
      }
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
 * Releases a send claim the user has checked on the provider.
 *
 * The server carries no way to tell whether an unconfirmed comment was posted,
 * so this is the user's decision, taken after looking. It is the only exit from
 * the unconfirmed state when the provider never answers.
 *
 * @param issueId - The issue whose claim is being released.
 * @returns A TanStack mutation.
 */
export function useReleaseSendClaim(issueId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<{ ok: true }, Error, { claimId?: string | null } | void>({
    mutationFn: async (input) => {
      if (!issueId) throw new Error("No issue selected");
      // The attempt this tab is showing. Naming it stops a superseded view from
      // releasing a claim a newer send now holds.
      const claimId = input && "claimId" in input ? input.claimId : null;
      const query = claimId ? `?claimId=${encodeURIComponent(claimId)}` : "";
      const res = await fetch(`/api/issues/${issueId}/draft${query}`, { method: "PATCH" });
      if (!res.ok) throw new Error(await readApiError(res, "Failed to release the send claim"));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["draft", issueId] });
    },
    onError: (error) => {
      toast.error(error.message);
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
