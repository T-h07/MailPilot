import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  getFocusQueue,
  getFocusSummary,
  type FocusQueueItem,
  type FocusQueueType,
  type FocusSummary,
} from "@/lib/api/focus";
import { runFollowupAction, updateFollowup } from "@/lib/api/followups";
import { emitFollowupUpdated, subscribeFollowupUpdated } from "@/lib/events/followups";
import { getAccentClasses } from "@/features/mailbox/utils/accent";

type QueueDefinition = {
  type: FocusQueueType;
  label: string;
  description: string;
};

const QUEUES: QueueDefinition[] = [
  {
    type: "NEEDS_REPLY",
    label: "Needs reply",
    description: "Open followups waiting for a response.",
  },
  {
    type: "OVERDUE",
    label: "Overdue",
    description: "Due dates already missed.",
  },
  {
    type: "DUE_TODAY",
    label: "Due today",
    description: "Items due before end of day.",
  },
  {
    type: "SNOOZED",
    label: "Snoozed",
    description: "Paused items waiting to wake up.",
  },
  {
    type: "ALL_OPEN",
    label: "All open",
    description: "All open followups currently tracked.",
  },
];

function queuePath(type: FocusQueueType): string {
  return type.toLowerCase().replace(/_/g, "-");
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed";
}

function formatQueueContext(item: FocusQueueItem): string {
  const now = Date.now();
  if (item.snoozedUntil) {
    return `Snoozed until ${new Date(item.snoozedUntil).toLocaleString()}`;
  }
  if (item.dueAt) {
    const due = new Date(item.dueAt);
    const deltaMs = due.getTime() - now;
    if (deltaMs < 0) {
      const overdueHours = Math.max(1, Math.floor(Math.abs(deltaMs) / (1000 * 60 * 60)));
      if (overdueHours < 24) {
        return `Overdue by ${overdueHours}h`;
      }
      return `Overdue by ${Math.floor(overdueHours / 24)}d`;
    }
    return `Due at ${due.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (item.needsReply) {
    return "Needs reply";
  }
  return "Open followup";
}

function summaryCount(summary: FocusSummary | null, type: FocusQueueType): number {
  if (!summary) {
    return 0;
  }
  switch (type) {
    case "NEEDS_REPLY":
      return summary.needsReplyOpen;
    case "OVERDUE":
      return summary.overdue;
    case "DUE_TODAY":
      return summary.dueToday;
    case "SNOOZED":
      return summary.snoozed;
    case "ALL_OPEN":
      return summary.openTotal;
  }
}

export function FocusPage() {
  const navigate = useNavigate();

  const [summary, setSummary] = useState<FocusSummary | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [activeQueue, setActiveQueue] = useState<FocusQueueType>("NEEDS_REPLY");
  const [queueItems, setQueueItems] = useState<FocusQueueItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingQueue, setIsLoadingQueue] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [actioningMessageId, setActioningMessageId] = useState<string | null>(null);

  const activeQueueMeta = useMemo(
    () => QUEUES.find((queue) => queue.type === activeQueue) ?? QUEUES[0],
    [activeQueue],
  );

  const loadSummary = useCallback(async () => {
    setIsLoadingSummary(true);
    setSummaryError(null);
    try {
      const response = await getFocusSummary();
      setSummary(response);
    } catch (error) {
      setSummaryError(toErrorMessage(error));
    } finally {
      setIsLoadingSummary(false);
    }
  }, []);

  const loadQueue = useCallback(
    async (cursor: string | null, append: boolean) => {
      setQueueError(null);
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoadingQueue(true);
      }
      try {
        const response = await getFocusQueue(activeQueue, 50, cursor);
        setQueueItems((previous) => (append ? [...previous, ...response.items] : response.items));
        setNextCursor(response.nextCursor);
      } catch (error) {
        setQueueError(toErrorMessage(error));
        if (!append) {
          setQueueItems([]);
          setNextCursor(null);
        }
      } finally {
        if (append) {
          setIsLoadingMore(false);
        } else {
          setIsLoadingQueue(false);
        }
      }
    },
    [activeQueue],
  );

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadQueue(null, false);
  }, [loadQueue]);

  useEffect(() => {
    return subscribeFollowupUpdated(() => {
      void loadSummary();
      void loadQueue(null, false);
    });
  }, [loadQueue, loadSummary]);

  const refreshFocusData = useCallback(async () => {
    await Promise.all([loadSummary(), loadQueue(null, false)]);
  }, [loadQueue, loadSummary]);

  const handleRunAction = useCallback(
    async (
      item: FocusQueueItem,
      action:
        | { type: "MARK_DONE" }
        | { type: "SNOOZE"; days: 1 | 3 | 7 }
        | { type: "CLEAR_SNOOZE" }
        | { type: "TOGGLE_NEEDS_REPLY" },
    ) => {
      setActioningMessageId(item.messageId);
      try {
        if (action.type === "MARK_DONE") {
          await runFollowupAction(item.messageId, { action: "MARK_DONE" });
        } else if (action.type === "SNOOZE") {
          await runFollowupAction(item.messageId, { action: "SNOOZE", days: action.days });
        } else if (action.type === "CLEAR_SNOOZE") {
          await updateFollowup(item.messageId, {
            status: "OPEN",
            needsReply: item.needsReply,
            dueAt: item.dueAt,
            snoozedUntil: null,
          });
        } else {
          await updateFollowup(item.messageId, {
            status: "OPEN",
            needsReply: !item.needsReply,
            dueAt: item.dueAt,
            snoozedUntil: item.snoozedUntil,
          });
        }
        emitFollowupUpdated();
        await refreshFocusData();
      } catch (error) {
        setQueueError(toErrorMessage(error));
      } finally {
        setActioningMessageId(null);
      }
    },
    [refreshFocusData],
  );

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Focus</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Action cockpit for followups. Drive response work, due queues, and snooze wakeups from one place.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {QUEUES.map((queue) => (
          <button
            className="mailbox-panel p-4 text-left transition-colors hover:bg-accent"
            key={queue.type}
            onClick={() => navigate(`/focus/drill/${queuePath(queue.type)}`)}
            type="button"
          >
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{queue.label}</p>
            <p className="pt-1 text-2xl font-semibold leading-none">
              {isLoadingSummary ? "..." : summaryCount(summary, queue.type)}
            </p>
            <p className="pt-2 text-xs text-muted-foreground">Open in mailbox drilldown</p>
          </button>
        ))}
      </div>

      {summaryError && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm text-destructive">{summaryError}</p>
            <Button onClick={() => void loadSummary()} size="sm" variant="outline">
              Retry summary
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {QUEUES.map((queue) => (
              <Button
                className={cn(
                  activeQueue === queue.type && "border-primary/50 bg-accent ring-1 ring-primary/20",
                )}
                key={queue.type}
                onClick={() => setActiveQueue(queue.type)}
                size="sm"
                variant="outline"
              >
                {queue.label}
                <Badge className="ml-2" variant="secondary">
                  {summaryCount(summary, queue.type)}
                </Badge>
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>{activeQueueMeta.label}</CardTitle>
              <CardDescription>{activeQueueMeta.description}</CardDescription>
            </div>
            <Button
              onClick={() => navigate(`/focus/drill/${queuePath(activeQueue)}`)}
              size="sm"
              variant="outline"
            >
              Open in mailbox
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {queueError && (
            <div className="rounded-md border border-border bg-card p-3 text-sm text-destructive">
              <p>{queueError}</p>
              <Button className="mt-3" onClick={() => void loadQueue(null, false)} size="sm" variant="outline">
                Retry queue
              </Button>
            </div>
          )}

          {!queueError && isLoadingQueue && (
            <div className="space-y-2">
              {Array.from({ length: 6 }, (_, index) => (
                <div className="h-16 animate-pulse rounded-lg border border-border bg-muted" key={index} />
              ))}
            </div>
          )}

          {!queueError && !isLoadingQueue && queueItems.length === 0 && (
            <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
              No messages in this queue right now.
            </div>
          )}

          {!queueError && !isLoadingQueue && queueItems.length > 0 && (
            <div className="space-y-2">
              {queueItems.map((item) => {
                const highlight = item.highlight ? getAccentClasses(item.highlight.accent) : null;
                const busy = actioningMessageId === item.messageId;
                return (
                  <div
                    className={cn(
                      "rounded-xl border border-border bg-card p-3",
                      item.highlight && highlight?.border,
                    )}
                    key={item.messageId}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {item.senderName} &lt;{item.senderEmail}&gt;
                        </p>
                        <p className="mailbox-snippet pt-1 text-sm">{item.subject}</p>
                        <p className="pt-1 text-xs text-muted-foreground">{item.snippet}</p>
                        <p className="pt-1 text-xs text-muted-foreground">{formatQueueContext(item)}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline">{item.accountEmail}</Badge>
                        {item.highlight && (
                          <Badge className={cn("border uppercase", highlight?.badge)} variant="outline">
                            {item.highlight.label}
                          </Badge>
                        )}
                        {item.isUnread && <Badge variant="secondary">Unread</Badge>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-3">
                      <Button
                        disabled={busy}
                        onClick={() => void handleRunAction(item, { type: "MARK_DONE" })}
                        size="sm"
                        variant="outline"
                      >
                        Mark done
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => void handleRunAction(item, { type: "SNOOZE", days: 1 })}
                        size="sm"
                        variant="outline"
                      >
                        Snooze 1d
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => void handleRunAction(item, { type: "SNOOZE", days: 3 })}
                        size="sm"
                        variant="outline"
                      >
                        Snooze 3d
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => void handleRunAction(item, { type: "SNOOZE", days: 7 })}
                        size="sm"
                        variant="outline"
                      >
                        Snooze 7d
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => void handleRunAction(item, { type: "CLEAR_SNOOZE" })}
                        size="sm"
                        variant="outline"
                      >
                        Clear snooze
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => void handleRunAction(item, { type: "TOGGLE_NEEDS_REPLY" })}
                        size="sm"
                        variant="outline"
                      >
                        {item.needsReply ? "Unset needs reply" : "Mark needs reply"}
                      </Button>
                      <Button
                        onClick={() => navigate(`/focus/drill/${queuePath(activeQueue)}`)}
                        size="sm"
                        variant="outline"
                      >
                        Open
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {nextCursor && !queueError && !isLoadingQueue && (
            <div className="flex justify-center">
              <Button
                disabled={isLoadingMore}
                onClick={() => void loadQueue(nextCursor, true)}
                size="sm"
                variant="outline"
              >
                {isLoadingMore ? "Loading..." : "Load more"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
