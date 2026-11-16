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
 * Reply composer for one issue.
 *
 * @param props - {@link ComposerProps}
 */
export function Composer({ issue, className }: ComposerProps) {
  const draftQuery = useDraft(issue.id);
  const saveDraft = useSaveDraft(issue.id);
  const discardDraft = useDiscardDraft(issue.id);
  const send = useSendReply(issue.id);
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

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** Caret position to restore after a programmatic insert. */
  const caretRef = useRef<number | null>(null);
  const saveDraftNow = saveDraft.mutate;

  const draft = draftQuery.data ?? null;
  const storedBody = draft?.body ?? "";
  const version = draft?.version ?? 0;
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
  useEffect(() => {
    if (!dirty || notice || sending) return;
    // An empty body with no stored draft is nothing to save, and creating a row
    // for it would make the composer look like it had work in progress.
    if (text.trim().length === 0 && version === 0) return;

    const timer = setTimeout(() => {
      saveDraftNow(
        { body: text, expectedVersion: version },
        {
          onSuccess: () => setSaveFailure(null),
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

  /** Take the stored draft, discarding anything typed here. */
  async function reloadStoredDraft() {
    await draftQuery.refetch();
    setTyped(null);
    setTypedBeforeLoad(false);
    setConflict(null);
    setSaveFailure(null);
  }

  /** Keep the typed text, adopting the freshly read version so the next save lands. */
  async function keepMine() {
    await draftQuery.refetch();
    setTypedBeforeLoad(false);
    setConflict(null);
    setSaveFailure(null);
  }

  function handleSend() {
    if (!canSend(sendState, text) || over) return;
    send.mutate(text, {
      // The draft row is gone server-side, so the local text goes with it. Done
      // in the callback rather than in an effect so nothing can repaint the old
      // reply after the success banner appears.
      onSuccess: () => {
        setTyped(null);
        setTypedBeforeLoad(false);
        setConflict(null);
        setSaveFailure(null);
      },
    });
  }

  function handleDiscard() {
    discardDraft.mutate(undefined, {
      onSuccess: () => {
        setTyped(null);
        setTypedBeforeLoad(false);
        setConflict(null);
        setSaveFailure(null);
      },
    });
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
          <p className="min-w-0 break-words text-xs leading-relaxed [overflow-wrap:anywhere]">
            {unconfirmedNotice(issue.url)}
          </p>
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
                disabled={!canSend(sendState, text) || over}
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
