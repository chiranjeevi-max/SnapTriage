/**
 * @module follow-up
 *
 * Barrel file that re-exports the follow-up discrimination rules, the query
 * hooks, and the queue/control components. Import from `@/features/follow-up`
 * rather than reaching into sub-modules directly.
 */

// The pure rules. The server decides with these same functions, so a client
// that re-described a reason would be able to disagree with the queue.
export { describeFollowUpReason, detectFollowUp, isBotLogin, compareCommentIds } from "./detection";
export type { FollowUpReason, FollowUpBaseline, FollowUpCheck } from "./detection";

// Hooks
export { useFollowUps, useCheckFollowUps, useFollowUpAction } from "./use-follow-ups";
export type {
  FollowUpEntry,
  FollowUpList,
  FollowUpCheckSummary,
  FollowUpActionInput,
  ReviewTrigger,
} from "./use-follow-ups";

// Components
export { FollowUpView } from "./components/follow-up-view";
export { FollowUpControl } from "./components/follow-up-control";
