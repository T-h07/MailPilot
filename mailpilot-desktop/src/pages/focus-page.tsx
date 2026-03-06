import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlarmClockCheck,
  Clock3,
  Inbox,
  MailWarning,
  RefreshCw,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AccentCard, type AccentColor } from "@/components/ui/AccentCard";
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
  accent: AccentColor;
  emptyTitle: string;
  emptyHint: string;
};

type QueueAction =
  | { type: "MARK_DONE" }
  | { type: "SNOOZE"; days: 1 | 3 | 7 }
  | { type: "CLEAR_SNOOZE" }
  | { type: "TOGGLE_NEEDS_REPLY" };

const QUEUES: QueueDefinition[] = [
  {
    type: "NEEDS_REPLY",
    label: "Needs reply",
    description: "Open followups waiting for a response.",
    accent: "orange",
    emptyTitle: "You're clear - no messages are waiting on a response.",
    emptyHint: "Check Inbox for new mail or mark a message as Needs reply to add it here.",
  },
  {
    type: "OVERDUE",
    label: "Overdue",
    description: "Due dates already missed.",
    accent: "red",
    emptyTitle: "No overdue followups. You're on time.",
    emptyHint: "Great pace. Keep deadlines current from your active queue.",
  },
  {
    type: "DUE_TODAY",
    label: "Due today",
    description: "Items due before end of day.",
    accent: "orange",
    emptyTitle: "Nothing due today yet.",
    emptyHint: "You can still triage Needs reply items before they become urgent.",
  },
  {
    type: "SNOOZED",
    label: "Snoozed",
    description: "Paused items waiting to wake up.",
    accent: "purple",
    emptyTitle: "No snoozed messages waking up right now.",
    emptyHint: "Use snooze actions to keep this queue focused on later followups.",
  },
  {
    type: "ALL_OPEN",
    label: "All open",
    description: "All open followups currently tracked.",
    accent: "blue",
    emptyTitle: "No active followups. Mark a message as Needs reply to start building your queue.",
    emptyHint: "Open Inbox to pick a message and create the first followup.",
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
    return `Due today ${due.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (item.needsReply) {
    return "Needs reply";
  }
  return "Open followup";
}

function isQueueMembership(item: FocusQueueItem, queueType: FocusQueueType): boolean {
  const now = Date.now();
  const dueAtMs = item.dueAt ? new Date(item.dueAt).getTime() : null;
  const snoozedMs = item.snoozedUntil ? new Date(item.snoozedUntil).getTime() : null;

  switch (queueType) {
    case "NEEDS_REPLY":
      return item.needsReply;
    case "OVERDUE":
      return dueAtMs !== null && dueAtMs < now;
    case "DUE_TODAY": {
      if (dueAtMs === null) {
        return false;
      }
      const due = new Date(dueAtMs);
      const today = new Date();
      return (
        due.getFullYear() === today.getFullYear() &&
        due.getMonth() === today.getMonth() &&
        due.getDate() === today.getDate()
      );
    }
    case "SNOOZED":
      return snoozedMs !== null && snoozedMs > now;
    case "ALL_OPEN":
      return item.needsReply || dueAtMs !== null || snoozedMs !== null;
  }
}

function applyOptimisticQueueUpdate(
  previousItems: FocusQueueItem[],
  item: FocusQueueItem,
  action: QueueAction,
  activeQueue: FocusQueueType
): FocusQueueItem[] {
  if (action.type === "MARK_DONE") {
    return previousItems.filter((entry) => entry.messageId !== item.messageId);
  }

  if (action.type === "SNOOZE") {
    const nextSnoozedUntil = new Date(Date.now() + action.days * 24 * 60 * 60 * 1000).toISOString();
    const updated = previousItems.map((entry) =>
      entry.messageId === item.messageId ? { ...entry, snoozedUntil: nextSnoozedUntil } : entry
    );
    return updated.filter((entry) => isQueueMembership(entry, activeQueue));
  }

  if (action.type === "CLEAR_SNOOZE") {
    const updated = previousItems.map((entry) =>
      entry.messageId === item.messageId ? { ...entry, snoozedUntil: null } : entry
    );
    return updated.filter((entry) => isQueueMembership(entry, activeQueue));
  }

  const updated = previousItems.map((entry) =>
    entry.messageId === item.messageId ? { ...entry, needsReply: !entry.needsReply } : entry
  );
  return updated.filter((entry) => isQueueMembership(entry, activeQueue));
}

function formatLastRefreshed(timestamp: string | null): string {
  if (!timestamp) {
    return "Not refreshed yet";
  }
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return "Not refreshed yet";
  }
  return parsed.toLocaleString();
}

export function FocusPage() {
  const navigate = useNavigate();
  const queueSectionRef = useRef<HTMLDivElement | null>(null);

  const [summary, setSummary] = useState<FocusSummary | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [activeQueue, setActiveQueue] = useState<FocusQueueType>("NEEDS_REPLY");
  const [queueItems, setQueueItems] = useState<FocusQueueItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingQueue, setIsLoadingQueue] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [actioningMessageId, setActioningMessageId] = useState<string | null>(null);

  const [snoozedPreviewItems, setSnoozedPreviewItems] = useState<FocusQueueItem[]>([]);

  const activeQueueMeta = useMemo(
    () => QUEUES.find((queue) => queue.type === activeQueue) ?? QUEUES[0],
    [activeQueue]
  );

  const loadSummary = useCallback(async () => {
    setIsLoadingSummary(true);
    setSummaryError(null);
    try {
      const response = await getFocusSummary();
      setSummary(response);
      setLastRefreshedAt(response.lastUpdatedAt ?? new Date().toISOString());
    } catch (error) {
      setSummaryError(toErrorMessage(error));
    } finally {
      setIsLoadingSummary(false);
    }
  }, []);

  const loadActiveQueue = useCallback(
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
    [activeQueue]
  );

  const loadSnoozedPreview = useCallback(async () => {
    try {
      const response = await getFocusQueue("SNOOZED", 120, null);
      setSnoozedPreviewItems(response.items);
    } catch {
      setSnoozedPreviewItems([]);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
    void loadSnoozedPreview();
  }, [loadSnoozedPreview, loadSummary]);

  useEffect(() => {
    void loadActiveQueue(null, false);
  }, [loadActiveQueue]);

  useEffect(() => {
    return subscribeFollowupUpdated(() => {
      void loadSummary();
      void loadSnoozedPreview();
      void loadActiveQueue(null, false);
    });
  }, [loadActiveQueue, loadSnoozedPreview, loadSummary]);

  const refreshFocusData = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([loadSummary(), loadSnoozedPreview(), loadActiveQueue(null, false)]);
    setIsRefreshing(false);
  }, [loadActiveQueue, loadSnoozedPreview, loadSummary]);

  const handleOpenQueue = useCallback(
    (queueType: FocusQueueType) => {
      if (queueType === activeQueue) {
        navigate(`/focus/drill/${queuePath(queueType)}`);
        return;
      }
      setActiveQueue(queueType);
      queueSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [activeQueue, navigate]
  );

  const openMailboxFromItem = useCallback(
    (item: FocusQueueItem) => {
      const params = new URLSearchParams();
      params.set("allOpen", "1");
      params.append("senderEmail", item.senderEmail.toLowerCase());
      params.append("accountId", item.accountId.toLowerCase());
      navigate(`/inbox?${params.toString()}`);
    },
    [navigate]
  );

  const handleRunAction = useCallback(
    async (item: FocusQueueItem, action: QueueAction) => {
      setActioningMessageId(item.messageId);
      setQueueItems((previous) => applyOptimisticQueueUpdate(previous, item, action, activeQueue));
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
        void Promise.all([loadSummary(), loadSnoozedPreview(), loadActiveQueue(null, false)]);
      } catch (error) {
        setQueueError(toErrorMessage(error));
        void loadActiveQueue(null, false);
      } finally {
        setActioningMessageId(null);
      }
    },
    [activeQueue, loadActiveQueue, loadSnoozedPreview, loadSummary]
  );

  const wakeupsSoon = useMemo(() => {
    const now = Date.now();
    const next24h = now + 24 * 60 * 60 * 1000;
    return snoozedPreviewItems
      .filter((item) => {
        if (!item.snoozedUntil) {
          return false;
        }
        const wakeMs = new Date(item.snoozedUntil).getTime();
        return wakeMs > now && wakeMs <= next24h;
      })
      .sort((left, right) => {
        const leftMs = left.snoozedUntil ? new Date(left.snoozedUntil).getTime() : Number.MAX_SAFE_INTEGER;
        const rightMs = right.snoozedUntil
          ? new Date(right.snoozedUntil).getTime()
          : Number.MAX_SAFE_INTEGER;
        return leftMs - rightMs;
      })
      .slice(0, 5);
  }, [snoozedPreviewItems]);

  const topSenders = useMemo(() => {
    if (summary && summary.topSenders.length > 0) {
      return summary.topSenders.slice(0, 6);
    }
    const grouped = new Map<string, { senderName: string; count: number }>();
    for (const item of queueItems) {
      const key = item.senderEmail.toLowerCase();
      const existing = grouped.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        grouped.set(key, { senderName: item.senderName, count: 1 });
      }
    }
    return Array.from(grouped.entries())
      .map(([senderEmail, value]) => ({
        senderEmail,
        senderName: value.senderName,
        count: value.count,
      }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 6);
  }, [queueItems, summary]);

  const byAccount = useMemo(() => {
    if (summary && summary.byAccount.length > 0) {
      return summary.byAccount.slice(0, 6);
    }
    const grouped = new Map<string, { accountId: string; count: number }>();
    for (const item of queueItems) {
      const key = item.accountEmail.toLowerCase();
      const existing = grouped.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        grouped.set(key, { accountId: item.accountId, count: 1 });
      }
    }
    return Array.from(grouped.entries())
      .map(([email, value]) => ({
        accountId: value.accountId,
        email,
        count: value.count,
      }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 6);
  }, [queueItems, summary]);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Focus</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Drive response work, deadlines, and wakeups from one place.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">Last refreshed: {formatLastRefreshed(lastRefreshedAt)}</Badge>
          <Button
            disabled={isRefreshing}
            onClick={() => void refreshFocusData()}
            size="sm"
            variant="outline"
          >
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {QUEUES.map((queue) => {
          const isActive = activeQueue === queue.type;
          return (
            <AccentCard
              accent={queue.accent}
              className={cn(
                "cursor-pointer transition-transform hover:-translate-y-0.5",
                isActive && "ring-1 ring-primary/40"
              )}
              heading={queue.label}
              key={queue.type}
              onClick={() => handleOpenQueue(queue.type)}
              role="button"
              tabIndex={0}
            >
              <p className="text-3xl font-semibold leading-none">
                {isLoadingSummary ? "..." : summaryCount(summary, queue.type)}
              </p>
              <p className="pt-2 text-xs text-muted-foreground">{queue.description}</p>
              <p className="pt-1 text-[11px] text-muted-foreground">
                {isActive ? "Active queue" : "Click to focus queue"}
              </p>
            </AccentCard>
          );
        })}
      </div>

      <AccentCard accent="blue" description="What today looks like" heading="Today's Agenda">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-border/70 bg-card/60 p-3">
            <p className="text-xs text-muted-foreground">Due today</p>
            <p className="pt-1 text-2xl font-semibold">{summary?.dueToday ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-card/60 p-3">
            <p className="text-xs text-muted-foreground">Overdue</p>
            <p className="pt-1 text-2xl font-semibold text-red-400">{summary?.overdue ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-card/60 p-3">
            <p className="text-xs text-muted-foreground">Wakeups next 24h</p>
            <p className="pt-1 text-2xl font-semibold text-violet-300">{summary?.wakeupsNext24h ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-card/60 p-3">
            <p className="text-xs text-muted-foreground">Open followups</p>
            <p className="pt-1 text-2xl font-semibold">{summary?.openTotal ?? 0}</p>
          </div>
        </div>
      </AccentCard>

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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <div className="space-y-4" ref={queueSectionRef}>
          <AccentCard
            accent={activeQueueMeta.accent}
            description={activeQueueMeta.description}
            heading={`${activeQueueMeta.label} Queue`}
            headerRight={
              <Button
                onClick={() => navigate(`/focus/drill/${queuePath(activeQueue)}`)}
                size="sm"
                variant="outline"
              >
                Open in mailbox
              </Button>
            }
          >
            <div className="sticky top-0 z-10 mb-3 flex flex-wrap gap-2 bg-card/95 py-1 backdrop-blur">
              {QUEUES.map((queue) => (
                <button
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs transition-colors",
                    activeQueue === queue.type
                      ? "border-primary/50 bg-accent text-foreground"
                      : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  key={queue.type}
                  onClick={() => setActiveQueue(queue.type)}
                  type="button"
                >
                  {queue.label}
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-secondary-foreground">
                    {summaryCount(summary, queue.type)}
                  </span>
                </button>
              ))}
            </div>

            {queueError && (
              <div className="rounded-md border border-border bg-card p-3 text-sm text-destructive">
                <p>{queueError}</p>
                <Button
                  className="mt-3"
                  onClick={() => void loadActiveQueue(null, false)}
                  size="sm"
                  variant="outline"
                >
                  Retry queue
                </Button>
              </div>
            )}

            {!queueError && isLoadingQueue && (
              <div className="space-y-2">
                {Array.from({ length: 6 }, (_, index) => (
                  <div
                    className="h-20 animate-pulse rounded-lg border border-border bg-muted"
                    key={`focus-loading-${index}`}
                  />
                ))}
              </div>
            )}

            {!queueError && !isLoadingQueue && queueItems.length === 0 && (
              <div className="rounded-lg border border-dashed border-border bg-card/70 p-5">
                <div className="flex items-start gap-3">
                  <Inbox className="mt-0.5 h-5 w-5 text-muted-foreground" />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">{activeQueueMeta.emptyTitle}</p>
                    <p className="text-xs text-muted-foreground">{activeQueueMeta.emptyHint}</p>
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button onClick={() => navigate("/inbox")} size="sm" variant="outline">
                        Open inbox
                      </Button>
                      {activeQueue !== "SNOOZED" && (
                        <Button onClick={() => setActiveQueue("SNOOZED")} size="sm" variant="outline">
                          Review snoozed
                        </Button>
                      )}
                      <Button onClick={() => void refreshFocusData()} size="sm" variant="outline">
                        Refresh
                      </Button>
                    </div>
                  </div>
                </div>
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
                        item.highlight && highlight?.border
                      )}
                      key={item.messageId}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">
                            {item.senderName} <span className="text-muted-foreground">&lt;{item.senderEmail}&gt;</span>
                          </p>
                          <p className="truncate pt-1 text-sm">{item.subject}</p>
                          <p className="truncate pt-1 text-xs text-muted-foreground">{item.snippet}</p>
                          <p className="pt-1 text-xs text-muted-foreground">{formatQueueContext(item)}</p>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <Badge variant="outline">{item.accountEmail}</Badge>
                          {item.highlight && (
                            <Badge className={cn("border uppercase", highlight?.badge)} variant="outline">
                              {item.highlight.label}
                            </Badge>
                          )}
                          {item.needsReply && <Badge variant="secondary">Needs reply</Badge>}
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
                        <Button disabled={busy} onClick={() => openMailboxFromItem(item)} size="sm" variant="outline">
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
                  onClick={() => void loadActiveQueue(nextCursor, true)}
                  size="sm"
                  variant="outline"
                >
                  {isLoadingMore ? "Loading..." : "Load more"}
                </Button>
              </div>
            )}
          </AccentCard>
        </div>

        <div className="space-y-4">
          <AccentCard accent="purple" heading="Wakeups soon" description="Snoozed items waking within 24 hours">
            {wakeupsSoon.length === 0 ? (
              <p className="text-sm text-muted-foreground">No snoozed wakeups in the next 24 hours.</p>
            ) : (
              <div className="space-y-2">
                {wakeupsSoon.map((item) => (
                  <button
                    className="w-full rounded-lg border border-border bg-card/70 p-2 text-left transition-colors hover:bg-muted"
                    key={`wake-${item.messageId}`}
                    onClick={() => openMailboxFromItem(item)}
                    type="button"
                  >
                    <p className="truncate text-xs font-semibold">{item.senderName}</p>
                    <p className="truncate text-xs text-muted-foreground">{item.subject}</p>
                    <p className="pt-1 text-[11px] text-muted-foreground">
                      Wakes {item.snoozedUntil ? new Date(item.snoozedUntil).toLocaleString() : "soon"}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </AccentCard>

          <AccentCard accent="blue" heading="Top senders in focus" description="Who is driving action pressure">
            {topSenders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sender pressure right now.</p>
            ) : (
              <div className="space-y-2">
                {topSenders.map((sender) => (
                  <button
                    className="flex w-full items-center justify-between rounded-lg border border-border bg-card/70 p-2 text-left hover:bg-muted"
                    key={`sender-${sender.senderEmail}`}
                    onClick={() =>
                      navigate(
                        `/inbox?allOpen=1&senderEmail=${encodeURIComponent(
                          sender.senderEmail.toLowerCase()
                        )}`
                      )
                    }
                    type="button"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold">{sender.senderName}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{sender.senderEmail}</p>
                    </div>
                    <Badge variant="secondary">{sender.count}</Badge>
                  </button>
                ))}
              </div>
            )}
          </AccentCard>

          <AccentCard accent="green" heading="By account" description="Open followups by connected account">
            {byAccount.length === 0 ? (
              <p className="text-sm text-muted-foreground">No account load to show.</p>
            ) : (
              <div className="space-y-2">
                {byAccount.map((account) => (
                  <button
                    className="flex w-full items-center justify-between rounded-lg border border-border bg-card/70 p-2 text-left hover:bg-muted"
                    key={`account-${account.accountId}-${account.email}`}
                    onClick={() =>
                      navigate(
                        `/inbox?allOpen=1&accountId=${encodeURIComponent(
                          account.accountId.toLowerCase()
                        )}`
                      )
                    }
                    type="button"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold">{account.email}</p>
                      <p className="text-[11px] text-muted-foreground">Open followups</p>
                    </div>
                    <Badge variant="secondary">{account.count}</Badge>
                  </button>
                ))}
              </div>
            )}
          </AccentCard>

          <AccentCard accent="orange" heading="Quick links" description="Jump to focused mailbox drilldowns">
            <div className="grid grid-cols-1 gap-2">
              <Button onClick={() => navigate("/focus/drill/needs-reply")} size="sm" variant="outline">
                <MailWarning className="h-4 w-4" />
                Needs reply drilldown
              </Button>
              <Button onClick={() => navigate("/focus/drill/overdue")} size="sm" variant="outline">
                <Clock3 className="h-4 w-4" />
                Overdue drilldown
              </Button>
              <Button onClick={() => navigate("/focus/drill/snoozed")} size="sm" variant="outline">
                <AlarmClockCheck className="h-4 w-4" />
                Snoozed drilldown
              </Button>
              <Button onClick={() => navigate("/focus/drill/all-open")} size="sm" variant="outline">
                <Users className="h-4 w-4" />
                All open drilldown
              </Button>
            </div>
          </AccentCard>
        </div>
      </div>
    </section>
  );
}