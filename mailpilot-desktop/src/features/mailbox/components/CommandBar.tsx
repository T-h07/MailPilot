import { useEffect, useRef } from "react";
import { EllipsisVertical, Loader2, MessageSquarePlus, Search, Settings2 } from "lucide-react";
import type { AccountScope, MailAccount, QuickFilterKey } from "@/features/mailbox/model/types";
import { AccountScopeDropdown } from "@/features/mailbox/components/AccountScopeDropdown";
import { FilterChips } from "@/features/mailbox/components/FilterChips";
import type { MailboxSortOrder } from "@/lib/api/mailbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type CommandBarProps = {
  accounts: MailAccount[];
  accountScope: AccountScope;
  hideAccountScope?: boolean;
  onAccountScopeChange: (scope: AccountScope) => void;
  searchQuery: string;
  onSearchQueryChange: (nextValue: string) => void;
  sortOrder: MailboxSortOrder;
  onSortOrderChange: (nextValue: MailboxSortOrder) => void;
  isSearchLoading?: boolean;
  activeFilters: Set<QuickFilterKey>;
  onToggleFilter: (filter: QuickFilterKey) => void;
  onResetFilters: () => void;
  onSettingsShortcut: () => void;
  onCompose: () => void;
};

export function CommandBar({
  accounts,
  accountScope,
  hideAccountScope = false,
  onAccountScopeChange,
  searchQuery,
  onSearchQueryChange,
  sortOrder,
  onSortOrderChange,
  isSearchLoading = false,
  activeFilters,
  onToggleFilter,
  onResetFilters,
  onSettingsShortcut,
  onCompose,
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
        {!hideAccountScope && (
          <AccountScopeDropdown
            accounts={accounts}
            onScopeChange={onAccountScopeChange}
            scope={accountScope}
          />
        )}
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9 pr-9"
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="Search sender, subject, snippet..."
            ref={searchInputRef}
            value={searchQuery}
          />
          {isSearchLoading && (
            <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        <select
          aria-label="Sort order"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          onChange={(event) => onSortOrderChange(event.target.value as MailboxSortOrder)}
          value={sortOrder}
        >
          <option value="RECEIVED_DESC">Newest first</option>
          <option value="RECEIVED_ASC">Oldest first</option>
        </select>
        <Button className="gap-2" onClick={onCompose}>
          <MessageSquarePlus className="h-4 w-4" />
          Compose
        </Button>
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
