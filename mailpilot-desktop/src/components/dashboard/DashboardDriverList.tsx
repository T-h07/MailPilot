export type DashboardDriverItem = {
  key: string;
  label: string;
  count: number;
  onClick: () => void;
};

type DashboardDriverListProps = {
  emptyLabel: string;
  items: DashboardDriverItem[];
  title: string;
};

export function DashboardDriverList({ emptyLabel, items, title }: DashboardDriverListProps) {
  const maxCount = Math.max(1, ...items.map((item) => item.count));

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">{title}</p>
      {items.length === 0 && <p className="text-sm text-muted-foreground">{emptyLabel}</p>}
      {items.map((item) => {
        const width = Math.max(8, Math.round((item.count / maxCount) * 100));
        return (
          <button
            className="w-full space-y-1 rounded-md p-1 text-left transition-colors hover:bg-muted/70"
            key={item.key}
            onClick={item.onClick}
            type="button"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">{item.label}</span>
              <span className="font-medium text-foreground">{item.count}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-muted">
              <div className="h-full rounded bg-primary/70" style={{ width: `${width}%` }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
