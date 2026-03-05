import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardSummary, type DashboardSummary } from "@/lib/api/dashboard";
import { ApiClientError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

type DashboardTile = {
  key: "unreadTotal" | "needsReplyOpen" | "overdue" | "dueToday" | "snoozed" | "unreadBoss";
  label: string;
  subtitle: string;
  drillPath?: string;
};

const DASHBOARD_TILES: DashboardTile[] = [
  {
    key: "unreadTotal",
    label: "Unread total",
    subtitle: "Unread inbox messages across accounts.",
    drillPath: "/inbox",
  },
  {
    key: "needsReplyOpen",
    label: "Needs reply",
    subtitle: "Open followups waiting on a response.",
    drillPath: "/focus/drill/needs-reply",
  },
  {
    key: "overdue",
    label: "Overdue",
    subtitle: "Open followups past due.",
    drillPath: "/focus/drill/overdue",
  },
  {
    key: "dueToday",
    label: "Due today",
    subtitle: "Followups due before the day ends.",
    drillPath: "/focus/drill/due-today",
  },
  {
    key: "snoozed",
    label: "Snoozed",
    subtitle: "Open followups currently snoozed.",
    drillPath: "/focus/drill/snoozed",
  },
  {
    key: "unreadBoss",
    label: "Unread from BOSS",
    subtitle: "Unread messages matching sender highlight label BOSS.",
  },
];

function toErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed";
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleString();
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const loadSummary = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await getDashboardSummary();
      setSummary(response);
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (!autoRefresh) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void loadSummary();
    }, 30000);
    return () => window.clearInterval(intervalId);
  }, [autoRefresh, loadSummary]);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Real-time cockpit of inbox action signals and followup pressure.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setAutoRefresh((previous) => !previous)} size="sm" variant="outline">
            {autoRefresh ? "Auto refresh: On (30s)" : "Auto refresh: Off"}
          </Button>
          <Button disabled={isLoading} onClick={() => void loadSummary()} size="sm" variant="outline">
            {isLoading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {DASHBOARD_TILES.map((tile) => {
          const value = summary ? summary[tile.key] : 0;
          const clickable = Boolean(tile.drillPath);
          return (
            <button
              className={cn(
                "mailbox-panel rounded-xl p-4 text-left",
                clickable && "transition-colors hover:bg-accent",
              )}
              disabled={!clickable}
              key={tile.key}
              onClick={() => {
                if (tile.drillPath) {
                  navigate(tile.drillPath);
                }
              }}
              type="button"
            >
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{tile.label}</p>
              <p className="pt-1 text-3xl font-semibold leading-none">{isLoading ? "..." : value}</p>
              <p className="pt-2 text-xs text-muted-foreground">{tile.subtitle}</p>
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription>Current snapshot freshness and API state.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          {error ? (
            <p className="text-destructive">{error}</p>
          ) : (
            <p>Last updated: {formatTimestamp(summary?.lastUpdatedAt ?? null)}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={autoRefresh ? "secondary" : "outline"}>
              {autoRefresh ? "Polling every 30s" : "Manual refresh"}
            </Badge>
            <Badge variant="outline">Range-free live counters</Badge>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
