/**
 * @module replies/components/discussion
 *
 * The issue's discussion, below its body.
 *
 * Two separate facts have to stay separate here. An empty thread means nobody
 * has replied; `supported: false` means the provider exposes no comment API and
 * this app cannot tell. Rendering the second as the first would tell a
 * maintainer that the reporter has gone quiet when the truth is that we cannot
 * see. So the unavailable case gets its own sentence and a link out.
 *
 * The list is bounded and scrolls on its own instead of growing the pane. It is
 * a sibling of the body's scroll area rather than a child of it: nesting one
 * scroller inside another makes the wheel ambiguous at the boundary, and the
 * body already owns the wheel for the length of a description.
 *
 * Paging is the server's cursor, used untouched. Providers page in opposite
 * directions and the adapters normalise both to "this page is oldest first, and
 * the cursor walks older", so re-deriving a page number here would reintroduce
 * the difference the adapters exist to hide.
 */
"use client";

import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, ChevronRight, ExternalLink, MessageSquare } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatRelativeTime } from "@/lib/utils";
import { useComments, type ReplyComment } from "@/features/replies/use-replies";

/** The first character of a login, for the avatar fallback. */
function initial(login: string | null): string {
  return login ? login.slice(0, 1).toUpperCase() : "?";
}

/** The author line for one comment. A system note has no author to name. */
function authorLabel(comment: ReplyComment): string {
  if (comment.author) return comment.author;
  return comment.isSystem ? "Provider" : "Unknown author";
}

/**
 * One comment. System notes stay visible but are marked as records rather than
 * replies: a label change is part of the history, and hiding it would make the
 * thread look like it skipped a beat.
 */
function CommentRow({ comment }: { comment: ReplyComment }) {
  return (
    <li
      className={cn(
        "rounded-md border px-3 py-2.5",
        comment.isSystem ? "border-dashed bg-muted/30" : "bg-card"
      )}
      aria-label={comment.isSystem ? "System note" : undefined}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Avatar size="sm">
          {comment.authorAvatar && <AvatarImage src={comment.authorAvatar} alt="" />}
          <AvatarFallback>{initial(comment.author)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">
          {authorLabel(comment)}
        </span>
        {comment.isSystem && (
          <span className="shrink-0 rounded-full border px-1.5 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
            note
          </span>
        )}
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/80">
          {formatRelativeTime(comment.createdAt, { suffix: true })}
        </span>
        {comment.url && (
          <a
            href={comment.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto shrink-0 rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
            aria-label={`Open ${authorLabel(comment)}'s comment on the provider`}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <div className="mt-2 min-w-0">
        {comment.body.trim().length > 0 ? (
          // The `.issue-body` styles are the ones the description already uses,
          // so a code block, a table, and a long URL behave identically in both
          // places instead of needing a second set of rules that drifts.
          <div className="issue-body text-[13px]">
            <Markdown remarkPlugins={[remarkGfm]}>{comment.body}</Markdown>
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground">This comment has no text.</p>
        )}
      </div>
    </li>
  );
}

interface DiscussionProps {
  /** The issue whose discussion is shown. */
  issueId: string;
  /** The issue on the provider, for the "unavailable" and empty cases. */
  providerUrl: string | null;
  /** Extra classes for the section. */
  className?: string;
}

/**
 * Collapsible, bounded discussion section.
 *
 * @param props - {@link DiscussionProps}
 */
export function Discussion({ issueId, providerUrl, className }: DiscussionProps) {
  // Open by default: the whole point of the pane is that a reply is visible
  // without a second click. Collapsing is for reading a long description.
  const [expanded, setExpanded] = useState(true);
  const query = useComments(issueId, expanded);

  // Pages arrive newest first and each page is oldest first, so reversing the
  // pages is what puts the thread back in reading order.
  // Deduplicated by id, keeping the first occurrence. A comment can land on two
  // pages when the provider shifts its window between requests, and React would
  // warn about duplicate keys while showing the same reply twice.
  const comments = query.data
    ? [
        ...new Map(
          [...query.data.pages]
            .reverse()
            .flatMap((page) => page.comments)
            .map((comment) => [comment.id, comment])
        ).values(),
      ]
    : [];
  const supported = query.data?.pages[0]?.supported ?? true;
  const loaded = comments.length;

  return (
    <section aria-label="Discussion" className={cn("flex min-h-0 flex-col border-t", className)}>
      <div className="flex shrink-0 items-center gap-2 px-6 py-2">
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          )}
          <MessageSquare className="h-3.5 w-3.5 shrink-0" />
          Discussion
          {query.data && supported && (
            <span className="font-mono tabular-nums text-muted-foreground/80">({loaded})</span>
          )}
        </button>

        {expanded && supported && query.hasNextPage && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-8 shrink-0 px-2 text-xs"
            disabled={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? "Loading…" : "Older comments"}
          </Button>
        )}
      </div>

      {expanded && (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
          {!supported ? (
            <div className="rounded-md border border-dashed px-3 py-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                This provider does not expose issue comments, so the discussion cannot be shown
                here. Replies have to be written on the issue itself.
              </p>
              {providerUrl && (
                <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
                  <a href={providerUrl} target="_blank" rel="noopener noreferrer">
                    Open the issue on the provider
                  </a>
                </Button>
              )}
            </div>
          ) : query.isPending ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              {[0, 1].map((index) => (
                <div key={index} className="flex flex-col gap-2 rounded-md border px-3 py-2.5">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              ))}
            </div>
          ) : query.isError && loaded === 0 ? (
            <div role="alert" className="rounded-md border border-dashed px-3 py-3">
              <p className="text-xs leading-relaxed text-destructive">{query.error.message}</p>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => query.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : (
            <>
              {/* A failed page fetch must not take the loaded thread with it. The
                  error replaces the list only when there is nothing cached, so a
                  failed "Older comments" reports itself above what already
                  rendered instead of blanking the conversation. */}
              {query.isError && (
                <div
                  role="alert"
                  className="mb-2 flex flex-wrap items-center gap-x-2 rounded-md border border-dashed px-3 py-2"
                >
                  <span className="text-xs leading-relaxed text-destructive">
                    {query.error.message}
                  </span>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => query.refetch()}
                  >
                    Try again
                  </Button>
                </div>
              )}
              {loaded === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">
                  No replies yet. A reply you send here would be the first.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {comments.map((comment) => (
                    <CommentRow key={comment.id} comment={comment} />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
