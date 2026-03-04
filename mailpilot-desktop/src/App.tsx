import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
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
  LayoutDashboard,
  Mailbox,
  Menu,
  Sparkles,
  Target,
} from "lucide-react";
import { InboxPage } from "@/pages/inbox-page";
import { FocusPage } from "@/pages/focus-page";
import { FocusDrillPage } from "@/pages/focus-drill-page";
import { ViewPage } from "@/pages/view-page";
import { InsightsPage } from "@/pages/insights-page";
import { SettingsPage } from "@/pages/settings-page";
import { ViewsHubPage } from "@/pages/views-hub-page";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ApiClientError } from "@/lib/api/client";
import { listViews, type ViewRecord } from "@/lib/api/views";

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
  onRetryViews: () => void;
  onNavigate?: () => void;
};

const navItems: SidebarLink[] = [
  { label: "Inbox", to: "/inbox", icon: Mailbox },
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
    case "/focus":
      return "Focus";
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
    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
    active
      ? "bg-primary text-primary-foreground shadow-sm"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );
}

function Sidebar({ views, viewsLoading, viewsError, onRetryViews, onNavigate }: SidebarProps) {
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
      <div className="border-b px-4 py-5">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <p className="text-base font-semibold leading-none">MailPilot</p>
            <p className="pt-1 text-xs text-muted-foreground">Inbox Cockpit</p>
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
                    className={({ isActive }) => linkClassName(isActive)}
                    onClick={onNavigate}
                    to={item.to}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </NavLink>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            ))}
            <Separator className="my-3" />
            <Collapsible onOpenChange={setViewsOpen} open={viewsOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  className={cn(
                    "w-full justify-between px-3 text-muted-foreground hover:text-foreground",
                    onViewRoute && "bg-muted text-foreground",
                  )}
                  variant="ghost"
                >
                  <span className="flex items-center gap-3">
                    <LayoutDashboard className="h-4 w-4" />
                    Views
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
                    <Button className="mt-2 w-full" onClick={onRetryViews} size="sm" variant="outline">
                      Retry
                    </Button>
                  </div>
                )}

                {!viewsLoading && !viewsError && views.length === 0 && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No saved views yet.</p>
                )}

                {!viewsLoading && !viewsError && views.map((view) => (
                  <NavLink
                    className={({ isActive }) =>
                      cn(
                        "ml-7 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )
                    }
                    key={view.id}
                    onClick={onNavigate}
                    to={`/views/${view.id}`}
                  >
                    <span className="truncate">{view.name}</span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px]">
                      P{view.priority}
                    </span>
                  </NavLink>
                ))}

                <NavLink
                  className={({ isActive }) =>
                    cn(
                      "ml-7 flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )
                  }
                  onClick={onNavigate}
                  to="/views/manage"
                >
                  <Cog className="h-3.5 w-3.5" />
                  Manage Views
                </NavLink>
              </CollapsibleContent>
            </Collapsible>
          </nav>
        </TooltipProvider>
      </ScrollArea>
      <div className="border-t p-3">
        <NavLink
          className={({ isActive }) => linkClassName(isActive)}
          onClick={onNavigate}
          to={settingsItem.to}
        >
          <settingsItem.icon className="h-4 w-4" />
          <span>{settingsItem.label}</span>
        </NavLink>
      </div>
    </div>
  );
}

function AppShell() {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);

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
    [location.pathname, views],
  );

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", themeMode === "dark");
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="sidebar-panel hidden w-[260px] shrink-0 border-r border-border md:block">
        <Sidebar
          onRetryViews={() => {
            void refreshViews();
          }}
          views={views}
          viewsError={viewsError}
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
                  onNavigate={() => setMobileNavOpen(false)}
                  onRetryViews={() => {
                    void refreshViews();
                  }}
                  views={views}
                  viewsError={viewsError}
                  viewsLoading={viewsLoading}
                />
              </SheetContent>
            </Sheet>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold leading-none">{pageTitle}</p>
              <p className="pt-1 text-xs text-muted-foreground">Desktop command deck</p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="rounded-full" size="sm" variant="outline">
                <Badge className="rounded-full" variant="secondary">
                  Offline • Not synced
                </Badge>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="z-[60] border-border bg-popover text-popover-foreground shadow-md"
            >
              <DropdownMenuLabel>Sync status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>Offline mode</DropdownMenuItem>
              <DropdownMenuItem disabled>Auto-sync (coming soon)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />} path="/">
          <Route element={<Navigate replace to="/inbox" />} index />
          <Route element={<InboxPage />} path="inbox" />
          <Route element={<FocusPage />} path="focus" />
          <Route element={<FocusDrillPage />} path="focus/drill/:type" />
          <Route element={<ViewsHubPage />} path="views/manage" />
          <Route element={<ViewPage />} path="views/:viewId" />
          <Route element={<InsightsPage />} path="insights" />
          <Route element={<SettingsPage />} path="settings" />
        </Route>
        <Route element={<Navigate replace to="/inbox" />} path="*" />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
