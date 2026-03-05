import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  ChevronDown,
  Cog,
  FileText,
  Gauge,
  LayoutDashboard,
  Lock,
  LogOut,
  Mailbox,
  Menu,
  Send,
  Sparkles,
  Target,
} from "lucide-react";
import { InboxPage } from "@/pages/inbox-page";
import { DashboardPage } from "@/pages/dashboard-page";
import { SentPage } from "@/pages/sent-page";
import { DraftsPage } from "@/pages/drafts-page";
import { FocusPage } from "@/pages/focus-page";
import { FocusDrillPage } from "@/pages/focus-drill-page";
import { ViewPage } from "@/pages/view-page";
import { InsightsPage } from "@/pages/insights-page";
import { SettingsPage } from "@/pages/settings-page";
import { ViewsHubPage } from "@/pages/views-hub-page";
import { OnboardingPage } from "@/pages/onboarding-page";
import { LocalLoginPage } from "@/pages/local-login-page";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AppLockOverlay } from "@/components/common/app-lock-overlay";
import { ApiClientError } from "@/api/client";
import { listViews, type ViewRecord } from "@/lib/api/views";
import {
  getAppState,
  lockApp,
  loginApp,
  logoutApp,
  type AppStateRecord,
  unlockApp,
} from "@/lib/api/app-state";
import { LiveEventsProvider, useLiveEvents } from "@/lib/events/live-events-context";

type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "mailpilot-theme";

export type AppOutletContext = {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  views: ViewRecord[];
  viewsLoading: boolean;
  viewsError: string | null;
  refreshViews: () => Promise<void>;
};

type SidebarLink = {
  label: string;
  to: string;
  icon: LucideIcon;
};

type SidebarProps = {
  views: ViewRecord[];
  viewsLoading: boolean;
  viewsError: string | null;
  inboxBadgeCount: number;
  viewBadgeCounts: Record<string, number>;
  viewsTotalBadgeCount: number;
  onRetryViews: () => void;
  onLock: () => Promise<void>;
  onLogout: () => Promise<void>;
  lockInFlight: boolean;
  logoutInFlight: boolean;
  onNavigate?: () => void;
};

type AppToast = {
  id: number;
  title: string;
  body: string;
};

const navItems: SidebarLink[] = [
  { label: "Dashboard", to: "/dashboard", icon: Gauge },
  { label: "Inbox", to: "/inbox", icon: Mailbox },
  { label: "Sent", to: "/sent", icon: Send },
  { label: "Drafts", to: "/drafts", icon: FileText },
  { label: "Focus", to: "/focus", icon: Target },
  { label: "Insights", to: "/insights", icon: BarChart3 },
];

const settingsItem: SidebarLink = {
  label: "Settings",
  to: "/settings",
  icon: Cog,
};

function getInitialThemeMode(): ThemeMode {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function toApiErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Failed to load views";
}

function resolveHeaderTitle(pathname: string, views: ViewRecord[]): string {
  if (pathname === "/views/manage") {
    return "Views Hub";
  }

  if (pathname.startsWith("/focus/drill/")) {
    return "Focus Drilldown";
  }

  if (pathname.startsWith("/views/")) {
    const viewId = pathname.replace("/views/", "");
    const view = views.find((candidate) => candidate.id === viewId);
    return `View · ${view?.name ?? "Unknown"}`;
  }

  switch (pathname) {
    case "/dashboard":
      return "Dashboard";
    case "/focus":
      return "Focus";
    case "/sent":
      return "Sent";
    case "/drafts":
      return "Drafts";
    case "/insights":
      return "Insights";
    case "/settings":
      return "Settings";
    case "/inbox":
    default:
      return "Inbox";
  }
}

function linkClassName(active: boolean): string {
  return cn(
    "flex w-full flex-row items-center justify-start gap-2 rounded-lg border border-transparent px-3 py-2.5 text-sm font-medium transition-colors",
    active
      ? "border-border bg-accent text-foreground shadow-sm"
      : "text-muted-foreground hover:bg-muted hover:text-foreground"
  );
}

function isSidebarRouteActive(pathname: string, to: string): boolean {
  if (to === "/focus") {
    return pathname === "/focus" || pathname.startsWith("/focus/");
  }
  if (to === "/inbox") {
    return pathname === "/inbox";
  }
  if (to === "/dashboard") {
    return pathname === "/dashboard";
  }
  if (to === "/sent") {
    return pathname === "/sent";
  }
  if (to === "/drafts") {
    return pathname === "/drafts";
  }
  if (to === "/insights") {
    return pathname === "/insights";
  }
  if (to === "/settings") {
    return pathname === "/settings";
  }
  return pathname === to;
}

function Sidebar({
  views,
  viewsLoading,
  viewsError,
  inboxBadgeCount,
  viewBadgeCounts,
  viewsTotalBadgeCount,
  onRetryViews,
  onLock,
  onLogout,
  lockInFlight,
  logoutInFlight,
  onNavigate,
}: SidebarProps) {
  const location = useLocation();
  const onViewRoute = location.pathname.startsWith("/views/");
  const [viewsOpen, setViewsOpen] = useState(onViewRoute);

  useEffect(() => {
    if (onViewRoute) {
      setViewsOpen(true);
    }
  }, [onViewRoute]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center border-b border-border px-4">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <Sparkles className="h-[18px] w-[18px]" />
          </div>
          <div>
            <p className="text-base font-semibold leading-none">MailPilot</p>
            <p className="pt-0.5 text-xs text-muted-foreground">Inbox Cockpit</p>
          </div>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <TooltipProvider delayDuration={120}>
          <nav className="space-y-1 p-3">
            <p className="sidebar-section-label px-2 text-muted-foreground">Navigation</p>
            {navItems.map((item) => (
              <Tooltip key={item.to}>
                <TooltipTrigger asChild>
                  <NavLink
                    className={linkClassName(isSidebarRouteActive(location.pathname, item.to))}
                    onClick={onNavigate}
                    to={item.to}
                  >
                    <item.icon className="h-[18px] w-[18px] shrink-0" />
                    <span>{item.label}</span>
                    {item.to === "/inbox" && inboxBadgeCount > 0 && (
                      <Badge
                        className="ml-auto rounded-full px-2 py-0 text-[10px]"
                        variant="secondary"
                      >
                        {inboxBadgeCount}
                      </Badge>
                    )}
                  </NavLink>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            ))}
            <Separator className="my-3" />
            <Collapsible onOpenChange={setViewsOpen} open={viewsOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  className="w-full justify-between px-3 text-muted-foreground hover:bg-muted hover:text-foreground"
                  variant="ghost"
                >
                  <span className="flex items-center gap-2">
                    <LayoutDashboard className="h-[18px] w-[18px] shrink-0" />
                    Views
                    {viewsTotalBadgeCount > 0 && (
                      <Badge className="rounded-full px-2 py-0 text-[10px]" variant="secondary">
                        {viewsTotalBadgeCount}
                      </Badge>
                    )}
                  </span>
                  <ChevronDown
                    className={cn("h-4 w-4 transition-transform", viewsOpen && "rotate-180")}
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1 pt-1">
                {viewsLoading && (
                  <div className="space-y-1 px-2 py-1">
                    {Array.from({ length: 4 }, (_, index) => (
                      <div
                        className="h-8 animate-pulse rounded-md bg-muted"
                        key={`views-loading-${index}`}
                      />
                    ))}
                  </div>
                )}

                {!viewsLoading && viewsError && (
                  <div className="rounded-md border border-border bg-card p-2 text-xs text-muted-foreground">
                    <p>{viewsError}</p>
                    <Button
                      className="mt-2 w-full"
                      onClick={onRetryViews}
                      size="sm"
                      variant="outline"
                    >
                      Retry
                    </Button>
                  </div>
                )}

                {!viewsLoading && !viewsError && views.length === 0 && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No saved views yet.</p>
                )}

                {!viewsLoading &&
                  !viewsError &&
                  views.map((view) => (
                    <NavLink
                      className={({ isActive }) =>
                        cn(
                          "ml-7 flex items-center justify-between gap-2 rounded-lg border border-transparent px-3 py-2 text-sm transition-colors",
                          isActive
                            ? "border-border bg-accent text-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )
                      }
                      key={view.id}
                      onClick={onNavigate}
                      to={`/views/${view.id}`}
                    >
                      <span className="truncate">{view.name}</span>
                      <span className="flex items-center gap-1.5">
                        {viewBadgeCounts[view.id] > 0 && (
                          <Badge className="rounded-full px-2 py-0 text-[10px]" variant="secondary">
                            {viewBadgeCounts[view.id]}
                          </Badge>
                        )}
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px]">
                          P{view.priority}
                        </span>
                      </span>
                    </NavLink>
                  ))}

                <NavLink
                  className={({ isActive }) =>
                    cn(
                      "ml-7 flex items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "border-border bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )
                  }
                  onClick={onNavigate}
                  to="/views/manage"
                >
                  <Cog className="h-[18px] w-[18px] shrink-0" />
                  Manage Views
                </NavLink>
              </CollapsibleContent>
            </Collapsible>
          </nav>
        </TooltipProvider>
      </ScrollArea>
      <div className="border-t p-3">
        <NavLink
          className={linkClassName(isSidebarRouteActive(location.pathname, settingsItem.to))}
          onClick={onNavigate}
          to={settingsItem.to}
        >
          <settingsItem.icon className="h-[18px] w-[18px] shrink-0" />
          <span>{settingsItem.label}</span>
        </NavLink>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button
            className="justify-start gap-2"
            disabled={lockInFlight}
            onClick={() => {
              void onLock();
              onNavigate?.();
            }}
            size="sm"
            variant="outline"
          >
            <Lock className="h-4 w-4" />
            {lockInFlight ? "Locking..." : "Lock"}
          </Button>
          <Button
            className="justify-start gap-2"
            disabled={logoutInFlight}
            onClick={() => {
              void onLogout();
              onNavigate?.();
            }}
            size="sm"
            variant="outline"
          >
            <LogOut className="h-4 w-4" />
            {logoutInFlight ? "Logging out..." : "Logout"}
          </Button>
        </div>
      </div>
    </div>
  );
}

type AppShellProps = {
  locked: boolean;
  lockInFlight: boolean;
  logoutInFlight: boolean;
  unlockInFlight: boolean;
  unlockError: string | null;
  onLock: () => Promise<void>;
  onLogout: () => Promise<void>;
  onUnlock: (password: string) => Promise<void>;
};

type AppRouteGuardProps = {
  appState: AppStateRecord | null;
  loggedIn: boolean;
  lockInFlight: boolean;
  logoutInFlight: boolean;
  unlockInFlight: boolean;
  unlockError: string | null;
  onLock: () => Promise<void>;
  onLogout: () => Promise<void>;
  onUnlock: (password: string) => Promise<void>;
};

type OnboardingRouteProps = {
  appState: AppStateRecord | null;
  loggedIn: boolean;
};

type LoginRouteProps = {
  appState: AppStateRecord | null;
  loggedIn: boolean;
  loginInFlight: boolean;
  loginError: string | null;
  onLogin: (password: string) => Promise<void>;
};

function AppShell({
  locked,
  lockInFlight,
  logoutInFlight,
  unlockInFlight,
  unlockError,
  onLock,
  onLogout,
  onUnlock,
}: AppShellProps) {
  const location = useLocation();
  const { badges, latestNewMail, newMailSequence, sseConnected, syncByAccountId } = useLiveEvents();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
  const [toasts, setToasts] = useState<AppToast[]>([]);
  const toastTimeoutsRef = useRef<Map<number, number>>(new Map());

  const [views, setViews] = useState<ViewRecord[]>([]);
  const [viewsLoading, setViewsLoading] = useState(false);
  const [viewsError, setViewsError] = useState<string | null>(null);

  const refreshViews = useCallback(async () => {
    setViewsLoading(true);
    setViewsError(null);
    try {
      const loadedViews = await listViews();
      setViews(loadedViews);
    } catch (error) {
      setViewsError(toApiErrorMessage(error));
    } finally {
      setViewsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshViews();
  }, [refreshViews]);

  const pageTitle = useMemo(
    () => resolveHeaderTitle(location.pathname, views),
    [location.pathname, views]
  );
  const syncPill = useMemo(() => {
    const statuses = Object.values(syncByAccountId);
    const running = statuses.find((status) => status.state === "RUNNING");
    if (running) {
      const progress =
        running.total && running.total > 0 && running.processed !== null
          ? ` • ${running.processed}/${running.total}`
          : "";
      return {
        label: `Syncing ${running.email}${progress}`,
        variant: "default" as const,
      };
    }

    const errored = statuses.find((status) => status.state === "ERROR");
    if (errored) {
      return {
        label: `Sync error • ${errored.email}`,
        variant: "destructive" as const,
      };
    }

    return {
      label: sseConnected ? "Idle" : "Idle • reconnecting",
      variant: "secondary" as const,
    };
  }, [sseConnected, syncByAccountId]);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", themeMode === "dark");
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!latestNewMail || newMailSequence === 0) {
      return;
    }

    const matchingView = views.find((view) => latestNewMail.viewMatches.includes(view.id));
    const targetLabel = matchingView?.name ?? "Inbox";
    const sender = latestNewMail.senderName?.trim() || latestNewMail.senderEmail;
    const subject = latestNewMail.subject?.trim() || "(no subject)";

    const toastId = Date.now() + Math.floor(Math.random() * 10000);
    const nextToast: AppToast = {
      id: toastId,
      title: `New mail in ${targetLabel}`,
      body: `${sender} — ${subject}`,
    };

    setToasts((previous) => {
      const next = [...previous, nextToast];
      while (next.length > 3) {
        const removed = next.shift();
        if (removed) {
          const timeoutId = toastTimeoutsRef.current.get(removed.id);
          if (timeoutId !== undefined) {
            window.clearTimeout(timeoutId);
            toastTimeoutsRef.current.delete(removed.id);
          }
        }
      }
      return next;
    });

    const timeoutId = window.setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== toastId));
      toastTimeoutsRef.current.delete(toastId);
    }, 5000);

    toastTimeoutsRef.current.set(toastId, timeoutId);
  }, [latestNewMail, newMailSequence, views]);

  useEffect(() => {
    return () => {
      for (const timeoutId of toastTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      toastTimeoutsRef.current.clear();
    };
  }, []);

  return (
    <div className="relative h-screen">
      <div
        className={cn(
          "flex h-full bg-background text-foreground transition duration-200",
          locked && "pointer-events-none select-none blur-[2px]"
        )}
      >
        <aside className="sidebar-panel hidden w-[260px] shrink-0 border-r border-border md:block">
          <Sidebar
            inboxBadgeCount={badges.inboxCount}
            lockInFlight={lockInFlight}
            logoutInFlight={logoutInFlight}
            onLock={onLock}
            onLogout={onLogout}
            onRetryViews={() => {
              void refreshViews();
            }}
            viewBadgeCounts={badges.viewCounts}
            views={views}
            viewsError={viewsError}
            viewsTotalBadgeCount={badges.viewsTotal}
            viewsLoading={viewsLoading}
          />
        </aside>
        <div className="app-shell-main flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 items-center justify-between border-b border-border bg-background px-4 md:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Sheet onOpenChange={setMobileNavOpen} open={mobileNavOpen}>
                <SheetTrigger asChild>
                  <Button className="md:hidden" size="icon" variant="outline">
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent className="w-[280px] p-0" side="left">
                  <SheetHeader className="sr-only">
                    <SheetTitle>Navigation</SheetTitle>
                  </SheetHeader>
                  <Sidebar
                    inboxBadgeCount={badges.inboxCount}
                    lockInFlight={lockInFlight}
                    logoutInFlight={logoutInFlight}
                    onLock={onLock}
                    onLogout={onLogout}
                    onNavigate={() => setMobileNavOpen(false)}
                    onRetryViews={() => {
                      void refreshViews();
                    }}
                    viewBadgeCounts={badges.viewCounts}
                    views={views}
                    viewsError={viewsError}
                    viewsTotalBadgeCount={badges.viewsTotal}
                    viewsLoading={viewsLoading}
                  />
                </SheetContent>
              </Sheet>
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold leading-none">{pageTitle}</p>
                <p className="pt-1 text-xs text-muted-foreground">Desktop command deck</p>
              </div>
            </div>
            <Badge className="rounded-full px-3 py-1 text-xs" variant={syncPill.variant}>
              {syncPill.label}
            </Badge>
          </header>
          <main className="flex-1 overflow-auto p-4 md:p-6">
            <div className="mx-auto max-w-7xl">
              <Outlet
                context={{
                  themeMode,
                  setThemeMode,
                  views,
                  viewsLoading,
                  viewsError,
                  refreshViews,
                }}
              />
            </div>
          </main>
          {toasts.length > 0 && (
            <div className="pointer-events-none fixed bottom-5 right-5 z-[80] space-y-2">
              {toasts.map((toast) => (
                <div
                  className="w-[320px] rounded-lg border border-border bg-card px-3 py-2 shadow-lg"
                  key={toast.id}
                >
                  <p className="text-xs font-semibold">{toast.title}</p>
                  <p className="pt-1 text-xs text-muted-foreground">{toast.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {locked && (
        <AppLockOverlay error={unlockError} isUnlocking={unlockInFlight} onUnlock={onUnlock} />
      )}
    </div>
  );
}

function BootstrappingScreen({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6">
        <p className="text-lg font-semibold">Loading MailPilot...</p>
        {error ? <p className="pt-2 text-sm text-destructive">{error}</p> : null}
        {error ? (
          <Button className="mt-4" onClick={onRetry} variant="outline">
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function OnboardingRoute({ appState, loggedIn }: OnboardingRouteProps) {
  if (!appState) {
    return <BootstrappingScreen error={null} onRetry={() => undefined} />;
  }
  if (appState.onboardingComplete && appState.hasPassword) {
    return <Navigate replace to={loggedIn ? "/inbox" : "/login"} />;
  }
  return (
    <OnboardingPage
      onStartSetup={() => {
        window.alert("Onboarding wizard is coming in MP-PT17.");
      }}
    />
  );
}

function LoginRoute({ appState, loggedIn, loginInFlight, loginError, onLogin }: LoginRouteProps) {
  if (!appState) {
    return <BootstrappingScreen error={null} onRetry={() => undefined} />;
  }
  if (!appState.onboardingComplete || !appState.hasPassword) {
    return <Navigate replace to="/onboarding" />;
  }
  if (loggedIn) {
    return <Navigate replace to="/inbox" />;
  }
  return <LocalLoginPage error={loginError} isLoading={loginInFlight} onLogin={onLogin} />;
}

function ProtectedAppShell({
  appState,
  loggedIn,
  lockInFlight,
  logoutInFlight,
  unlockInFlight,
  unlockError,
  onLock,
  onLogout,
  onUnlock,
}: AppRouteGuardProps) {
  if (!appState) {
    return <BootstrappingScreen error={null} onRetry={() => undefined} />;
  }
  if (!appState.onboardingComplete || !appState.hasPassword) {
    return <Navigate replace to="/onboarding" />;
  }
  if (!loggedIn) {
    return <Navigate replace to="/login" />;
  }

  return (
    <LiveEventsProvider>
      <AppShell
        lockInFlight={lockInFlight}
        locked={appState.locked}
        logoutInFlight={logoutInFlight}
        onLock={onLock}
        onLogout={onLogout}
        onUnlock={onUnlock}
        unlockError={unlockError}
        unlockInFlight={unlockInFlight}
      />
    </LiveEventsProvider>
  );
}

function App() {
  const [appState, setAppState] = useState<AppStateRecord | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [loginInFlight, setLoginInFlight] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [lockInFlight, setLockInFlight] = useState(false);
  const [unlockInFlight, setUnlockInFlight] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [logoutInFlight, setLogoutInFlight] = useState(false);

  const refreshAppState = useCallback(async () => {
    const state = await getAppState();
    setAppState(state);
  }, []);

  const bootstrapAppState = useCallback(async () => {
    setIsBootstrapping(true);
    setBootstrapError(null);
    try {
      await refreshAppState();
    } catch (error) {
      setBootstrapError(toApiErrorMessage(error));
    } finally {
      setIsBootstrapping(false);
    }
  }, [refreshAppState]);

  useEffect(() => {
    void bootstrapAppState();
  }, [bootstrapAppState]);

  const handleLogin = useCallback(
    async (password: string) => {
      setLoginInFlight(true);
      setLoginError(null);
      try {
        await loginApp(password);
        setLoggedIn(true);
        await refreshAppState();
      } catch (error) {
        setLoginError(toApiErrorMessage(error));
      } finally {
        setLoginInFlight(false);
      }
    },
    [refreshAppState]
  );

  const handleLock = useCallback(async () => {
    setLockInFlight(true);
    try {
      await lockApp();
      setAppState((previous) => (previous ? { ...previous, locked: true } : previous));
    } finally {
      setLockInFlight(false);
    }
  }, []);

  const handleUnlock = useCallback(async (password: string) => {
    setUnlockInFlight(true);
    setUnlockError(null);
    try {
      await unlockApp(password);
      setAppState((previous) => (previous ? { ...previous, locked: false } : previous));
    } catch (error) {
      setUnlockError(toApiErrorMessage(error));
    } finally {
      setUnlockInFlight(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    setLogoutInFlight(true);
    try {
      await logoutApp();
      setLoggedIn(false);
      await refreshAppState();
    } finally {
      setLogoutInFlight(false);
    }
  }, [refreshAppState]);

  const wildcardRedirect = useMemo(() => {
    if (!appState || !appState.onboardingComplete || !appState.hasPassword) {
      return "/onboarding";
    }
    if (!loggedIn) {
      return "/login";
    }
    return "/inbox";
  }, [appState, loggedIn]);

  if (isBootstrapping) {
    return <BootstrappingScreen error={bootstrapError} onRetry={() => void bootstrapAppState()} />;
  }
  if (!appState) {
    return (
      <BootstrappingScreen
        error={bootstrapError ?? "Unable to load application state."}
        onRetry={() => void bootstrapAppState()}
      />
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<OnboardingRoute appState={appState} loggedIn={loggedIn} />} path="/onboarding" />
        <Route
          element={
            <LoginRoute
              appState={appState}
              loggedIn={loggedIn}
              loginError={loginError}
              loginInFlight={loginInFlight}
              onLogin={handleLogin}
            />
          }
          path="/login"
        />
        <Route
          element={
            <ProtectedAppShell
              appState={appState}
              lockInFlight={lockInFlight}
              loggedIn={loggedIn}
              logoutInFlight={logoutInFlight}
              onLock={handleLock}
              onLogout={handleLogout}
              onUnlock={handleUnlock}
              unlockError={unlockError}
              unlockInFlight={unlockInFlight}
            />
          }
          path="/"
        >
          <Route element={<Navigate replace to="/inbox" />} index />
          <Route element={<DashboardPage />} path="dashboard" />
          <Route element={<InboxPage />} path="inbox" />
          <Route element={<SentPage />} path="sent" />
          <Route element={<DraftsPage />} path="drafts" />
          <Route element={<FocusPage />} path="focus" />
          <Route element={<FocusDrillPage />} path="focus/drill/:type" />
          <Route element={<ViewsHubPage />} path="views/manage" />
          <Route element={<ViewPage />} path="views/:viewId" />
          <Route element={<InsightsPage />} path="insights" />
          <Route element={<SettingsPage />} path="settings" />
        </Route>
        <Route element={<Navigate replace to={wildcardRedirect} />} path="*" />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
