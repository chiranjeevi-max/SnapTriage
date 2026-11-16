/**
 * @module replies
 *
 * Barrel file that re-exports the reply send-state rules, the query hooks, and
 * the discussion/composer components. Import from `@/features/replies` rather
 * than reaching into sub-modules directly.
 */

// The send rules. Never reimplemented at the call site: the duplicate-post
// guard is a product invariant, and a second copy of it is a copy that drifts.
export { replySendState, canSend, unconfirmedNotice } from "./send-state";
export type { ReplySendState, ReplyDraftShape } from "./send-state";

// Hooks
export {
  useComments,
  useDraft,
  useSaveDraft,
  useDiscardDraft,
  useSendReply,
  useSavedReplies,
  useCreateSavedReply,
  useUpdateSavedReply,
  useDeleteSavedReply,
  DraftConflictError,
  UnconfirmedSendError,
  COMMENTS_PAGE_SIZE,
} from "./use-replies";
export type {
  ReplyComment,
  CommentsPage,
  ReplyDraft,
  SavedReply,
  SaveDraftInput,
  CreateSavedReplyInput,
  UpdateSavedReplyInput,
  PostedReply,
  ReplyIssue,
} from "./use-replies";

// Components
export { Discussion } from "./components/discussion";
export { Composer } from "./components/composer";
