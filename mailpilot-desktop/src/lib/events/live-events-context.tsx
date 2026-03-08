import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getBadgeSummary,
  markInboxOpened as apiMarkInboxOpened,
  markViewOpened as apiMarkViewOpened,
} from "@/lib/api/badges";
import { getSyncStatus } from "@/lib/api/sync";
import {
  sseClient,
  type BadgeUpdateEvent,
  type NewMailEvent,
  type SyncStatusEvent,
} from "@/lib/events/sse";
import {
  LiveEventsContext,
  type BadgeState,
  type LiveEventsContextValue,
  type LiveSyncState,
} from "@/lib/events/live-events-store";

const DISCONNECT_FALLBACK_DELAY_MS = 10000;
const FALLBACK_POLL_INTERVAL_MS = 15000;

function toBadgeState(payload: BadgeUpdateEvent): BadgeState {
  return {
    inboxCount: Math.max(0, payload.inbox ?? 0),
    viewsTotal: Math.max(0, payload.viewsTotal ?? 0),
    viewCounts: payload.views ?? {},
  };
}

function applyOptimisticViewReset(previous: BadgeState, viewId: string): BadgeState {
  const previousCount = previous.viewCounts[viewId] ?? 0;
  return {
    inboxCount: previous.inboxCount,
    viewsTotal: Math.max(0, previous.viewsTotal - previousCount),
    viewCounts: {
      ...previous.viewCounts,
      [viewId]: 0,
    },
  };
}

function mergeSyncEvent(
  previous: Record<string, LiveSyncState>,
  event: SyncStatusEvent
): Record<string, LiveSyncState> {
  return {
    ...previous,
    [event.accountId]: {
      accountId: event.accountId,
      email: event.email,
      state: event.state,
      processed: event.processed ?? null,
      total: event.total ?? null,
      message: event.message ?? null,
      lastSyncAt: previous[event.accountId]?.lastSyncAt ?? null,
      lastRunStartedAt: previous[event.accountId]?.lastRunStartedAt ?? null,
    },
  };
}

export function LiveEventsProvider({ children }: { children: React.ReactNode }) {
  const [badges, setBadges] = useState<BadgeState>({
    inboxCount: 0,
    viewsTotal: 0,
    viewCounts: {},
  });
  const [syncByAccountId, setSyncByAccountId] = useState<Record<string, LiveSyncState>>({});
  const [sseConnected, setSseConnected] = useState(false);
  const [latestNewMail, setLatestNewMail] = useState<NewMailEvent | null>(null);
  const [newMailSequence, setNewMailSequence] = useState(0);
  const [disconnectedAtMs, setDisconnectedAtMs] = useState<number | null>(null);

  const fallbackPollIntervalRef = useRef<number | null>(null);

  const refreshBadges = useCallback(async () => {
    const summary = await getBadgeSummary();
    setBadges({
      inboxCount: Math.max(0, summary.inbox ?? 0),
      viewsTotal: Math.max(0, summary.viewsTotal ?? 0),
      viewCounts: summary.views ?? {},
    });
  }, []);

  const refreshSyncStatus = useCallback(async () => {
    const statusRows = await getSyncStatus();
    const next: Record<string, LiveSyncState> = {};

    for (const row of statusRows) {
      next[row.accountId] = {
        accountId: row.accountId,
        email: row.email,
        state: row.status,
        processed: row.processed ?? null,
        total: row.total ?? null,
        message: row.message ?? row.lastError ?? null,
        lastSyncAt: row.lastSyncAt ?? null,
        lastRunStartedAt: row.lastRunStartedAt ?? null,
      };
    }

    setSyncByAccountId(next);
  }, []);

  const refreshFallbackSnapshots = useCallback(async () => {
    const [badgesResult, syncResult] = await Promise.allSettled([
      refreshBadges(),
      refreshSyncStatus(),
    ]);
    if (badgesResult.status === "rejected" || syncResult.status === "rejected") {
      // Ignore transient fallback polling errors; SSE reconnect will reconcile state.
    }
  }, [refreshBadges, refreshSyncStatus]);

  const markInboxOpened = useCallback(async () => {
    setBadges((previous) => ({
      ...previous,
      inboxCount: 0,
    }));

    try {
      await apiMarkInboxOpened();
    } catch {
      void refreshBadges();
    }
  }, [refreshBadges]);

  const markViewOpened = useCallback(
    async (viewId: string) => {
      setBadges((previous) => applyOptimisticViewReset(previous, viewId));

      try {
        await apiMarkViewOpened(viewId);
      } catch {
        void refreshBadges();
      }
    },
    [refreshBadges]
  );

  useEffect(() => {
    const offConnection = sseClient.onConnectionChange((connected) => {
      setSseConnected(connected);
    });
    const offBadgeUpdate = sseClient.on("badge_update", (payload) => {
      setBadges(toBadgeState(payload));
    });
    const offSyncStatus = sseClient.on("sync_status", (payload) => {
      setSyncByAccountId((previous) => mergeSyncEvent(previous, payload));
    });
    const offNewMail = sseClient.on("new_mail", (payload) => {
      setLatestNewMail(payload);
      setNewMailSequence((previous) => previous + 1);
    });

    sseClient.start();

    return () => {
      offNewMail();
      offSyncStatus();
      offBadgeUpdate();
      offConnection();
      sseClient.stop();
    };
  }, []);

  useEffect(() => {
    void refreshBadges();
    void refreshSyncStatus();
  }, [refreshBadges, refreshSyncStatus]);

  useEffect(() => {
    if (sseConnected) {
      setDisconnectedAtMs(null);
      if (fallbackPollIntervalRef.current !== null) {
        window.clearInterval(fallbackPollIntervalRef.current);
        fallbackPollIntervalRef.current = null;
      }
      return;
    }

    setDisconnectedAtMs((previous) => previous ?? Date.now());
  }, [sseConnected]);

  useEffect(() => {
    if (sseConnected || disconnectedAtMs === null) {
      return;
    }

    const checkInterval = window.setInterval(() => {
      if (sseConnected || disconnectedAtMs === null) {
        return;
      }

      const disconnectedDuration = Date.now() - disconnectedAtMs;
      if (disconnectedDuration < DISCONNECT_FALLBACK_DELAY_MS) {
        return;
      }

      if (fallbackPollIntervalRef.current !== null) {
        return;
      }

      void refreshFallbackSnapshots();
      fallbackPollIntervalRef.current = window.setInterval(() => {
        void refreshFallbackSnapshots();
      }, FALLBACK_POLL_INTERVAL_MS);
    }, 1000);

    return () => {
      window.clearInterval(checkInterval);
    };
  }, [disconnectedAtMs, refreshFallbackSnapshots, sseConnected]);

  useEffect(() => {
    return () => {
      if (fallbackPollIntervalRef.current !== null) {
        window.clearInterval(fallbackPollIntervalRef.current);
      }
    };
  }, []);

  const value = useMemo<LiveEventsContextValue>(
    () => ({
      badges,
      syncByAccountId,
      sseConnected,
      latestNewMail,
      newMailSequence,
      refreshBadges,
      refreshSyncStatus,
      markInboxOpened,
      markViewOpened,
    }),
    [
      badges,
      latestNewMail,
      markInboxOpened,
      markViewOpened,
      newMailSequence,
      refreshBadges,
      refreshSyncStatus,
      sseConnected,
      syncByAccountId,
    ]
  );

  return <LiveEventsContext.Provider value={value}>{children}</LiveEventsContext.Provider>;
}
