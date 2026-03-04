import { useEffect, useRef } from "react";
import { EllipsisVertical, MessageSquarePlus, Search, Settings2 } from "lucide-react";
import type { AccountScope, MailAccount, QuickFilterKey } from "@/features/mailbox/model/types";
import { AccountScopeDropdown } from "@/features/mailbox/components/AccountScopeDropdown";
import { FilterChips } from "@/features/mailbox/components/FilterChips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type CommandBarProps = {
  accounts: MailAccount[];
  accountScope: AccountScope;
  onAccountScopeChange: (scope: AccountScope) => void;
  searchQuery: string;
  onSearchQueryChange: (nextValue: string) => void;
  activeFilters: Set<QuickFilterKey>;
  onToggleFilter: (filter: QuickFilterKey) => void;
  onResetFilters: () => void;
  onSettingsShortcut: () => void;
};

export function CommandBar({
  accounts,
  accountScope,
  onAccountScopeChange,
  searchQuery,
  onSearchQueryChange,
  activeFilters,
  onToggleFilter,
  onResetFilters,
  onSettingsShortcut,
}: CommandBarProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleFocusShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleFocusShortcut);
    return () => window.removeEventListener("keydown", handleFocusShortcut);
  }, []);

  return (
    <div className="mailbox-panel space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <AccountScopeDropdown
          accounts={accounts}
          onScopeChange={onAccountScopeChange}
          scope={accountScope}
        />
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="Search sender, subject, snippet..."
            ref={searchInputRef}
            value={searchQuery}
          />
        </div>
        <ComposePlaceholder />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="outline">
              <EllipsisVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="z-[60] border-border bg-popover text-popover-foreground shadow-md"
          >
            <DropdownMenuItem disabled>Sync now (coming soon)</DropdownMenuItem>
            <DropdownMenuItem disabled>Export selected (coming soon)</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSettingsShortcut}>
              <Settings2 className="h-4 w-4" />
              Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <FilterChips
        activeFilters={activeFilters}
        onReset={onResetFilters}
        onToggleFilter={onToggleFilter}
      />
    </div>
  );
}

function ComposePlaceholder() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <MessageSquarePlus className="h-4 w-4" />
          Compose
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Compose (MP-PT15)</DialogTitle>
          <DialogDescription>
            Composer workflow is intentionally deferred to a later milestone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button disabled>Send (not implemented)</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
