import type { QuickFilterKey } from "@/features/mailbox/model/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const filterDefinitions: Array<{ key: QuickFilterKey; label: string }> = [
  { key: "UNREAD", label: "Unread" },
  { key: "NEEDS_REPLY", label: "Needs reply" },
  { key: "OVERDUE", label: "Overdue" },
  { key: "DUE_TODAY", label: "Due today" },
  { key: "SNOOZED", label: "Snoozed" },
];

type FilterChipsProps = {
  activeFilters: Set<QuickFilterKey>;
  onToggleFilter: (filter: QuickFilterKey) => void;
  onReset: () => void;
};

export function FilterChips({ activeFilters, onToggleFilter, onReset }: FilterChipsProps) {
  const allSelected = activeFilters.size === 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        className={cn(
          "rounded-full px-3",
          allSelected && "bg-primary text-primary-foreground hover:bg-primary/90"
        )}
        onClick={onReset}
        size="sm"
        variant={allSelected ? "default" : "outline"}
      >
        All
      </Button>
      {filterDefinitions.map((filter) => {
        const isActive = activeFilters.has(filter.key);
        return (
          <Button
            className={cn(
              "rounded-full px-3",
              isActive && "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
            key={filter.key}
            onClick={() => onToggleFilter(filter.key)}
            size="sm"
            variant={isActive ? "default" : "outline"}
          >
            {filter.label}
          </Button>
        );
      })}
    </div>
  );
}
