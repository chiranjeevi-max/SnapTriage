/**
 * @module replies/components/composer
 *
 * The reply composer: draft, saved templates, and the one irreversible button
 * in the app.
 *
 * The state machine is not implemented here. {@link replySendState},
 * {@link canSend}, and {@link unconfirmedNotice} decide what may happen; this
 * component only renders that decision. The duplicate-post rule is a product
 * invariant, not a rendering detail, and a second copy of it inside JSX is a
 * copy that will eventually disagree with the first.
 *
 * The editor holds one piece of state: what the user has typed, or `null` while
 * they have not typed anything. Everything else is read from the draft query,
 * which the save and send mutations keep current. That makes the two hazards
 * here go away structurally instead of needing guards.
 *
 * A draft fetch landing after the first keystroke cannot overwrite it, because
 * typed text wins over the stored body for as long as it exists. And a
 * successful send cannot leave stale text behind, because clearing the typed
 * text falls back to the draft the send has already deleted.
 *
 * Autosave exists so a reload, a crash, or a second tab cannot eat prose. It is
 * a debounce, never a send: only the Send button publishes. The save carries the
 * version this editor last read, so a lost race becomes a banner the user
 * resolves rather than text silently replaced.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ExternalLink, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, formatRelativeTime } from "@/lib/utils";
import { providerLimits, type ProviderName } from "@/lib/provider-interface";
import { useKeyboardStore } from "@/features/keyboard";
import {
  DraftConflictError,
  UnconfirmedSendError,
  useDiscardDraft,
  useDraft,
  useSaveDraft,
  useReleaseSendClaim,
  useSavedReplies,
  useSendReply,
  type SavedReply,
} from "@/features/replies/use-replies";
import { canSend, replySendState, unconfirmedNotice } from "@/features/replies/send-state";

/** How long typing has to stop before the draft is saved. */
const AUTOSAVE_DELAY_MS = 1500;

/**
 * How close to the provider's cap the counter starts showing.
 *
 * A character count on every keystroke is noise for the 99% of replies that are
 * three sentences. A thousand characters is close enough that the number
 * arrives while the user can still do something about it.
 */
const COUNTER_VISIBILITY_MARGIN = 1000;

/**
 * The banner for a stored draft that arrived after an edit had started.
 *
 * A conflict rather than a merge: both bodies are real, and only the person who
 * wrote them can say which one to keep. Silently taking either would be the
 * overwrite the version check exists to prevent.
 */
const STORED_DRAFT_ARRIVED_LATE =
  "This issue already had a saved draft, which arrived after you started typing.";

/**
 * Shown when text came back from a flush that could not be saved.
 *
 * The flush runs as the composer unmounts, so the failure had nowhere to report
 * to. This is the only place the user learns the text survived.
 */
const RECOVERED_TEXT_NOTICE =
  "A reply you were writing could not be saved when you left this issue.";

/**
 * The provider's comment cap, or `null` for a provider this build does not
 * know. An unknown provider must not silently inherit GitHub's limit.
 *
 * @param provider - The issue's provider slug.
 */
function commentLimit(provider: string): number | null {
  if (!(provider in providerLimits)) return null;
  return providerLimits[provider as ProviderName].comment;
}

/** Where a saved template goes when it is applied. */
type InsertMode = "cursor" | "replace";

interface ComposerProps {
  /** The issue the reply would be posted to. */
  issue: { id: string; url: string; provider: string };
  /** Extra classes for the panel. */
  className?: string;
}

/**
 * Text an unmount flush could not save, keyed by issue.
 *
 * Module scope, because the component that owned the text is gone by the time the
 * request settles. It exists only to keep a copy the user can be offered again —
 * a 409 or a network failure during unmount otherwise lost their text with no
 * trace and no way to know it happened.
 */
const stashedFlush = new Map<string, string>();

/**
 * Reply composer for one issue.
 *
 * @param props - {@link ComposerProps}
 */
export function Composer({ issue, className }: ComposerProps) {
  const queryClient = useQueryClient();
  const draftQuery = useDraft(issue.id);
  const saveDraft = useSaveDraft(issue.id);
  const discardDraft = useDiscardDraft(issue.id);
  const send = useSendReply(issue.id);
  const releaseClaim = useReleaseSendClaim(issue.id);
  const savedReplies = useSavedReplies();
  const setSavedReplyPickerOpen = useKeyboardStore((s) => s.setSavedReplyPickerOpen);

  /** Text the user has typed, or `null` while the stored draft is authoritative. */
  const [typed, setTyped] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [saveFailure, setSaveFailure] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<SavedReply | null>(null);
  /**
   * `true` when a keystroke arrived before the draft fetch resolved.
   *
   * Tracked so a late arrival is reported rather than written over: saving this
   * text against the version that just loaded would replace whatever another
   * tab wrote, which is exactly the collision the version check prevents.
   */
  const [typedBeforeLoad, setTypedBeforeLoad] = useState(false);
  /**
   * The draft revision this editor is writing against, once it has diverged.
   *
   * `null` means "follow the loaded draft", which is correct until something is
   * typed. After that it is pinned and moved only by this editor's own save, or
   * by an explicit "keep mine". Following `draftQuery.data` instead would adopt
   * another tab's version silently and let this editor's older text save over
   * the newer draft without ever raising a conflict.
   */
  const [pinnedVersion, setPinnedVersion] = useState<number | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** Caret position to restore after a programmatic insert. */
  const caretRef = useRef<number | null>(null);
  const saveDraftNow = saveDraft.mutate;
  /** The text still owed to the server, so an unmount can flush it. */
  const unsaved = useRef<{ body: string; expectedVersion: number } | null>(null);

  const draft = draftQuery.data ?? null;
  const storedBody = draft?.body ?? "";
  const version = pinnedVersion ?? draft?.version ?? 0;
  const text = typed ?? storedBody;
  const dirty = typed !== null && typed !== storedBody;

  const sendState = replySendState(
    draft,
    send.isPending,
    send.error instanceof UnconfirmedSendError
  );
  const sending = send.isPending;
  const unconfirmed = sendState === "unconfirmed";

  const limit = commentLimit(issue.provider);
  const over = limit !== null && text.length > limit;
  const remaining = limit === null ? null : limit - text.length;

  const lateArrival =
    typedBeforeLoad &&
    draftQuery.data !== undefined &&
    storedBody.length > 0 &&
    // A stored body equal to what was typed is this editor's own text coming
    // back, not a collision: reporting that would show a conflict banner next to
    // the unconfirmed notice after every retried send.
    storedBody !== typed;
  const notice = conflict ?? (lateArrival ? STORED_DRAFT_ARRIVED_LATE : null);

  // Text an unmount flush could not save, recovered when the composer is opened
  // again. Read once on mount and removed from the stash, so it is offered
  // exactly once: the user either keeps it or discards it deliberately, rather
  // than finding the same text reappear every time the pane is opened.
  const [recovered] = useState(() => {
    const stashed = stashedFlush.get(issue.id);
    if (stashed === undefined) return null;
    stashedFlush.delete(issue.id);
    return stashed;
  });
  /** Set when the user has answered the recovery banner, either way. */
  const [recoveredDismissed, setRecoveredDismissed] = useState(false);

  // Send is withheld until the draft has loaded. Without this an early Ctrl+Enter
  // would post with no version, the server would skip its version predicate, and
  // an unread draft could be published over and then deleted.
  const draftReady = draftQuery.isSuccess;
  const sendBlocked = !draftReady || notice !== null;

  // The counter appears only inside the margin, and only then does it earn a
  // sentence: below the margin the composer shows nothing rather than a count
  // that changes on every keystroke.
  const counter =
    remaining === null || remaining > COUNTER_VISIBILITY_MARGIN
      ? null
      : over
        ? `${(-remaining).toLocaleString()} over the ${limit.toLocaleString()} limit`
        : `${remaining.toLocaleString()} left`;

  // A send whose outcome this client could not confirm must keep Send withheld
  // even though the server's marker may already be gone. The mutation error is
  // the latch: TanStack keeps it until the next attempt, so there is nothing to
  // mirror in state and no effect to keep in sync.

  useEffect(() => {
    const caret = caretRef.current;
    if (caret === null) return;
    caretRef.current = null;
    const element = textareaRef.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(caret, caret);
  }, [text]);

  // The picker is a dialog, so the inbox's global shortcuts have to know it is
  // open: `d` behind an open dialog would dismiss an issue nobody was looking
  // at. The flag is cleared on unmount so a selection change cannot leave it
  // latched and mute the keyboard for the rest of the session.
  useEffect(() => {
    setSavedReplyPickerOpen(pickerOpen);
    return () => setSavedReplyPickerOpen(false);
  }, [pickerOpen, setSavedReplyPickerOpen]);

  // Autosave. Nothing runs while a conflict is unresolved or a send is in
  // flight: saving during a send would race the attempt marker the server just
  // wrote, and saving under an unresolved conflict would be the clobber the
  // banner exists to prevent.
  // Mirrored outside the effect so an unmount can read it without re-running the
  // debounce. Cleared when a save succeeds, which is what makes the flush below
  // send only text the server does not already have.
  useEffect(() => {
    // `sending` is included deliberately: once Send owns this text, a flush must
    // not write it back. A send that succeeds deletes the draft, and a flush that
    // lands afterwards would recreate the published text as a fresh unsent
    // draft, which reads as a reply that never went out.
    unsaved.current =
      dirty && !notice && !sending ? { body: text, expectedVersion: version } : null;
  }, [dirty, notice, sending, text, version]);

  // Flush on unmount. Switching issues, or losing the pane to a re-render, would
  // otherwise discard text typed inside the debounce window with no copy
  // anywhere but this component's state.
  useEffect(() => {
    return () => {
      const pending = unsaved.current;
      if (!pending || pending.body.trim().length === 0) return;
      // `keepalive` lets the request outlive the component, and the save is
      // version-conditional, so a duplicate loses the race harmlessly.
      void fetch(`/api/issues/${issue.id}/draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending),
        keepalive: true,
      })
        .then((res) => {
          // Any failure keeps a copy. The component that owned this text is
          // already gone, so a 400, a 401, a 5xx or a 409 all leave the user with
          // nothing unless the text is held somewhere they can get it back from.
          if (!res.ok) {
            stashedFlush.set(issue.id, pending.body);
            return;
          }
          // The flush wrote a revision the cache does not know about. Without
          // this the next visit shows the older cached draft for up to a minute
          // and the user's newest text looks lost.
          void queryClient.invalidateQueries({ queryKey: ["draft", issue.id] });
        })
        .catch(() => {
          stashedFlush.set(issue.id, pending.body);
        });
    };
  }, [issue.id, queryClient]);

  useEffect(() => {
    if (!dirty || notice || sending) return;
    // An empty body with no stored draft is nothing to save, and creating a row
    // for it would make the composer look like it had work in progress.
    if (text.trim().length === 0 && version === 0) return;

    const timer = setTimeout(() => {
      saveDraftNow(
        { body: text, expectedVersion: version },
        {
          onSuccess: (saved) => {
            setSaveFailure(null);
            setTypedBeforeLoad(false);
            // This editor's own write is the one case where the base may move:
            // the next save has to carry the version the server just stored.
            setPinnedVersion(saved.version);
          },
          onError: (error) => {
            if (error instanceof DraftConflictError) {
              setConflict(error.message);
              return;
            }
            // The text stays exactly where it is. A failed save is retried by
            // the next keystroke, never by a timer, so an outage cannot turn
            // into a burst of requests.
            setSaveFailure(error.message);
          },
        }
      );
    }, AUTOSAVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [dirty, notice, sending, text, version, saveDraftNow]);

  /**
   * Record text the user typed.
   *
   * The draft fetch may still be in flight; if it is, the arrival is flagged so
   * the stored copy is offered rather than written over.
   */
  function noteTyped(next: string) {
    if (draftQuery.data === undefined) setTypedBeforeLoad(true);
    // Pin the write base at the first keystroke. From here the load result no
    // longer decides which revision this text belongs to, so a refetch triggered
    // by another tab cannot rebase it silently.
    setPinnedVersion((current) => current ?? draft?.version ?? 0);
    setTyped(next);
    setConflict(null);
  }

  /** Put the caret back after React swaps the textarea's value. */
  function insertAtCursor(body: string) {
    const element = textareaRef.current;
    const start = element ? element.selectionStart : text.length;
    const end = element ? element.selectionEnd : text.length;
    caretRef.current = start + body.length;
    noteTyped(`${text.slice(0, start)}${body}${text.slice(end)}`);
  }

  /** Apply a saved template in the mode the user chose. */
  function applyReply(reply: SavedReply, mode: InsertMode) {
    if (mode === "cursor") {
      insertAtCursor(reply.body);
    } else {
      noteTyped(reply.body);
    }
    setPicked(null);
    setPickerOpen(false);
  }

  /**
   * Take the stored draft, discarding anything typed here.
   *
   * Only on a successful read. TanStack reports a failed refetch in the result
   * rather than throwing, so awaiting alone proves nothing: clearing on failure
   * would discard the typed text and drop the conflict banner while leaving the
   * stale cache in place, which loses the user's work and hides why.
   */
  async function reloadStoredDraft() {
    const result = await draftQuery.refetch();
    if (!result.isSuccess) {
      setSaveFailure("Could not reload the stored draft. Your text is still here.");
      return;
    }
    setTyped(null);
    setTypedBeforeLoad(false);
    setConflict(null);
    setSaveFailure(null);
  }

  /**
   * Keep the typed text, adopting the freshly read version so the next save lands.
   *
   * Same rule as {@link reloadStoredDraft}: a failed read leaves the conflict in
   * place, because adopting an unknown version would write the text against a
   * revision this editor never saw.
   */
  async function keepMine() {
    const result = await draftQuery.refetch();
    if (!result.isSuccess) {
      setSaveFailure("Could not reload the stored draft. Your text is still here.");
      return;
    }
    // The user chose this text over the stored copy, so the base moves to what
    // the server just returned. That is the one deliberate rebase, and without it
    // every later save would collide with the version the other tab wrote.
    setPinnedVersion(result.data?.version ?? 0);
    setTypedBeforeLoad(false);
    setConflict(null);
    setSaveFailure(null);
  }

  function handleSend() {
    if (!canSend(sendState, text) || over || sendBlocked) return;
    send.mutate(
      // The base this edit began from, not whatever the latest refetch returned.
      // `version` is the pinned base autosave uses; sending `draft.version`
      // instead let a send carry a version the text on screen was never written
      // against, so the server's staleness check compared the wrong pair.
      { body: text, expectedVersion: version },
      {
        // The draft row is gone server-side, so the local text goes with it. Done
        // in the callback rather than in an effect so nothing can repaint the old
        // reply after the success banner appears.
        onSuccess: () => {
          setTyped(null);
          setTypedBeforeLoad(false);
          setConflict(null);
          setSaveFailure(null);
          // `version` was this draft's; the next edit starts a new base.
          setPinnedVersion(null);
        },
      }
    );
  }

  function handleDiscard() {
    discardDraft.mutate(
      // The version this editor is writing against, matching `handleSend`. Using
      // the refetched `draft.version` instead would delete a draft this tab never
      // saw: after a failed send or a claim release the refetch can carry a newer
      // version, and the delete would then be authorised against text that is not
      // the text on screen. `0` still asserts "no stored draft was ever seen".
      { expectedVersion: version },
      {
        onSuccess: () => {
          setTyped(null);
          setTypedBeforeLoad(false);
          setConflict(null);
          setSaveFailure(null);
          setPinnedVersion(null);
        },
      }
    );
  }

  const posted = send.isSuccess;

  return (
    <section
      aria-label="Reply composer"
      className={cn("shrink-0 border-t bg-card px-6 py-4", className)}
    >
      {posted && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-dashed px-3 py-2">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--state-open)]" />
          <p className="min-w-0 break-words text-xs leading-relaxed [overflow-wrap:anywhere]">
            Reply posted. It is public on the issue and cannot be edited or removed from here.
            <a
              href={send.data?.comment.url ?? issue.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 underline underline-offset-4"
            >
              View it on the provider
            </a>
          </p>
        </div>
      )}

      {unconfirmed && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-md border border-dashed px-3 py-2"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="break-words text-xs leading-relaxed [overflow-wrap:anywhere]">
              {unconfirmedNotice(issue.url)}
            </p>
            {/* The only exit when the provider never answers: the user looks at
                the issue and says the outcome is settled, which releases the
                claim so this draft can be edited or sent again. */}
            <Button
              variant="outline"
              size="sm"
              className="mt-2 h-8 px-2.5 text-xs"
              disabled={releaseClaim.isPending}
              onClick={() =>
                releaseClaim.mutate(
                  { claimId: draft?.sendClaimId },
                  {
                    // The server claim is gone, so the local error describing it
                    // is stale. Without this the composer keeps rendering
                    // "unconfirmed" from the failed mutation and Send stays
                    // hidden, even though the draft is editable again.
                    onSuccess: () => send.reset(),
                  }
                )
              }
            >
              {releaseClaim.isPending ? "Releasing…" : "I checked the issue"}
            </Button>
          </div>
        </div>
      )}

      {recovered !== null && !recoveredDismissed && typed === null && (
        <div role="alert" className="mb-3 rounded-md border border-dashed px-3 py-2">
          <p className="text-xs leading-relaxed">{RECOVERED_TEXT_NOTICE}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Not saved. Keep it to carry on where you left off, or discard it.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs"
              // Pins the base at the loaded version: this text was never written
              // against one, so the first save has to be conditional on the draft
              // as it stands now rather than on nothing.
              onClick={() => {
                setPinnedVersion(draft?.version ?? 0);
                setTyped(recovered);
              }}
            >
              Keep my text
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2.5 text-xs"
              onClick={() => setRecoveredDismissed(true)}
            >
              Discard
            </Button>
          </div>
        </div>
      )}

      {notice && (
        <div role="alert" className="mb-3 rounded-md border border-dashed px-3 py-2">
          <p className="text-xs leading-relaxed">{notice}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            The text below is still yours and has not been saved. Reload to take the stored version,
            or keep yours and overwrite it.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs"
              onClick={() => void reloadStoredDraft()}
            >
              Reload the stored draft
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2.5 text-xs"
              onClick={() => void keepMine()}
            >
              Keep my text
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={`reply-${issue.id}`} className="text-xs font-medium">
          Reply
        </label>
        <div className="flex min-w-0 items-center gap-2">
          {saveFailure && (
            <span className="min-w-0 truncate text-[11px] text-destructive" title={saveFailure}>
              Not saved. Your text is kept here and retried as you type.
            </span>
          )}
          {!saveFailure && dirty && !notice && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {saveDraft.isPending ? "saving…" : "unsaved"}
            </span>
          )}
          {!saveFailure && !dirty && draft && (
            <span className="font-mono text-[11px] text-muted-foreground">
              saved {formatRelativeTime(draft.updatedAt, { suffix: true })}
            </span>
          )}
        </div>
      </div>

      <textarea
        id={`reply-${issue.id}`}
        ref={textareaRef}
        value={text}
        rows={4}
        disabled={sending}
        onChange={(event) => noteTyped(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            handleSend();
          }
        }}
        placeholder="Write a reply. This posts publicly to the issue."
        className="mt-1.5 min-h-[5.5rem] w-full min-w-0 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm [overflow-wrap:anywhere] placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none disabled:opacity-60"
      />

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {/* In the unconfirmed state Send is not rendered at all rather than
            shown greyed out: a disabled button next to "we could not confirm
            this was posted" still reads as the thing to press once it wakes up,
            and pressing it is exactly what must not happen. */}
        {unconfirmed ? (
          <Button asChild variant="outline" size="sm" className="h-9 gap-1.5 px-3 text-xs">
            <a href={issue.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              Check the issue
            </a>
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                className="h-9 gap-1.5 px-3 text-xs"
                disabled={!canSend(sendState, text) || over || sendBlocked}
                onClick={handleSend}
              >
                <Send className="h-3.5 w-3.5" />
                {sending ? "Sending…" : "Send"}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              Post this reply. It cannot be undone. ⌘↵ or Ctrl↵
            </TooltipContent>
          </Tooltip>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="h-9 px-2.5 text-xs"
          onClick={() => {
            setPicked(null);
            setPickerOpen(true);
          }}
        >
          Saved replies
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-1.5 px-2.5 text-xs text-muted-foreground"
          disabled={(!dirty && !draft) || discardDraft.isPending}
          onClick={handleDiscard}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Discard
        </Button>

        <span className="ml-auto flex items-center gap-3 font-mono text-[11px] tabular-nums text-muted-foreground">
          {counter && (
            <span className={cn(over && "text-destructive")} aria-live="polite">
              {counter}
            </span>
          )}
        </span>
      </div>

      <Dialog
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open);
          if (!open) setPicked(null);
        }}
      >
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-3 sm:max-w-md">
          <DialogHeader className="shrink-0 pr-6">
            <DialogTitle>Saved replies</DialogTitle>
            <DialogDescription>
              Templates you reuse. Inserting one never replaces text you have not read.
            </DialogDescription>
          </DialogHeader>

          {picked ? (
            <div className="flex min-h-0 flex-col gap-3">
              <p className="min-w-0 break-words text-sm leading-relaxed [overflow-wrap:anywhere]">
                The composer already has text. Insert “{picked.name}” at the cursor, or replace what
                is there?
              </p>
              <div className="flex flex-wrap justify-end gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 px-2.5 text-xs"
                  onClick={() => setPicked(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-2.5 text-xs"
                  onClick={() => applyReply(picked, "cursor")}
                >
                  Insert at cursor
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-9 px-2.5 text-xs"
                  onClick={() => applyReply(picked, "replace")}
                >
                  Replace draft
                </Button>
              </div>
            </div>
          ) : (
            <SavedReplyList
              replies={savedReplies.data ?? []}
              isLoading={savedReplies.isPending}
              hasText={text.trim().length > 0}
              onPick={(reply) => {
                if (text.trim().length === 0) {
                  applyReply(reply, "cursor");
                  return;
                }
                setPicked(reply);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

interface SavedReplyListProps {
  replies: SavedReply[];
  isLoading: boolean;
  /** `true` when the composer holds text that a template would overwrite. */
  hasText: boolean;
  onPick: (reply: SavedReply) => void;
}

/** Searchable list of templates. */
function SavedReplyList({ replies, isLoading, hasText, onPick }: SavedReplyListProps) {
  const [filter, setFilter] = useState("");

  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? replies.filter(
        (reply) =>
          reply.name.toLowerCase().includes(needle) || reply.body.toLowerCase().includes(needle)
      )
    : replies;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Input
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Search saved replies…"
        aria-label="Search saved replies"
        className="h-9 shrink-0 text-sm"
      />
      {hasText && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          A template is inserted only after you choose how it should meet the text already here.
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="py-4 text-xs text-muted-foreground">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="py-4 text-xs text-muted-foreground">
            {replies.length === 0
              ? "No saved replies yet. The templates you reuse most belong here."
              : "No saved reply matches that search."}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {visible.map((reply) => (
              <li key={reply.id}>
                <button
                  type="button"
                  onClick={() => onPick(reply)}
                  className="flex w-full min-w-0 flex-col gap-1 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                >
                  <span className="min-w-0 break-words text-sm [overflow-wrap:anywhere]">
                    {reply.name}
                  </span>
                  <span className="line-clamp-2 min-w-0 break-words text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                    {reply.body.slice(0, 240)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
