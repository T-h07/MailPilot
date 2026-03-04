import { useEffect, useLayoutEffect, useMemo, useState } from "react";
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
import { ViewPage } from "@/pages/view-page";
import { InsightsPage } from "@/pages/insights-page";
import { SettingsPage } from "@/pages/settings-page";
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

type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "mailpilot-theme";

export type AppOutletContext = {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
};

type SidebarLink = {
  label: string;
  to: string;
  icon: LucideIcon;
};

type SidebarProps = {
  onNavigate?: () => void;
};

const navItems: SidebarLink[] = [
  { label: "Inbox", to: "/inbox", icon: Mailbox },
  { label: "Focus", to: "/focus", icon: Target },
  { label: "Insights", to: "/insights", icon: BarChart3 },
];

const viewItems = [
  { key: "work", label: "Work" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "gaming", label: "Gaming" },
  { key: "marketing", label: "Marketing" },
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

function resolveHeaderTitle(pathname: string): string {
  if (pathname.startsWith("/views/")) {
    const key = pathname.replace("/views/", "");
    return `View · ${formatViewLabel(key)}`;
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

function formatViewLabel(viewKey: string): string {
  return viewItems.find((view) => view.key === viewKey)?.label ?? "Custom";
}

function linkClassName(active: boolean): string {
  return cn(
    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
    active
      ? "bg-primary text-primary-foreground shadow-sm"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );
}

function Sidebar({ onNavigate }: SidebarProps) {
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
                {viewItems.map((view) => (
                  <NavLink
                    className={({ isActive }) =>
                      cn(
                        "ml-7 block rounded-lg px-3 py-2 text-sm transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )
                    }
                    key={view.key}
                    onClick={onNavigate}
                    to={`/views/${view.key}`}
                  >
                    {view.label}
                  </NavLink>
                ))}
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
  const pageTitle = useMemo(() => resolveHeaderTitle(location.pathname), [location.pathname]);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", themeMode === "dark");
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="sidebar-panel hidden w-[260px] shrink-0 border-r border-border md:block">
        <Sidebar />
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
                <Sidebar onNavigate={() => setMobileNavOpen(false)} />
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
            <Outlet context={{ themeMode, setThemeMode }} />
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
          <Route element={<ViewPage />} path="views/:viewKey" />
          <Route element={<InsightsPage />} path="insights" />
          <Route element={<SettingsPage />} path="settings" />
        </Route>
        <Route element={<Navigate replace to="/inbox" />} path="*" />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
