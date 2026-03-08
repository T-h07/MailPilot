import { createContext } from "react";
import type { NewMailEvent } from "@/lib/events/sse";

export type BadgeState = {
  inboxCount: number;
  viewsTotal: number;
  viewCounts: Record<string, number>;
};

export type LiveSyncState = {
  accountId: string;
  email: string;
  state: "RUNNING" | "IDLE" | "ERROR";
  processed: number | null;
  total: number | null;
  message: string | null;
  lastSyncAt: string | null;
  lastRunStartedAt: string | null;
};

export type LiveEventsContextValue = {
  badges: BadgeState;
  syncByAccountId: Record<string, LiveSyncState>;
  sseConnected: boolean;
  latestNewMail: NewMailEvent | null;
  newMailSequence: number;
  refreshBadges: () => Promise<void>;
  refreshSyncStatus: () => Promise<void>;
  markInboxOpened: () => Promise<void>;
  markViewOpened: (viewId: string) => Promise<void>;
};

export const LiveEventsContext = createContext<LiveEventsContextValue | null>(null);
