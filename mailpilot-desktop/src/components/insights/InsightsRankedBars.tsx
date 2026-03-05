export type InsightsRankedItem = {
  key: string;
  label: string;
  count: number;
  onClick: () => void;
};

type InsightsRankedBarsProps = {
  emptyLabel: string;
  items: InsightsRankedItem[];
  title: string;
};

export function InsightsRankedBars({ emptyLabel, items, title }: InsightsRankedBarsProps) {
  const maxValue = Math.max(1, ...items.map((item) => item.count));

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">{title}</p>
      {items.length === 0 && <p className="text-sm text-muted-foreground">{emptyLabel}</p>}
      {items.map((item) => {
        const widthPercent = Math.max(6, Math.round((item.count / maxValue) * 100));
        return (
          <button
            className="w-full space-y-1 rounded-md p-1 text-left transition-colors hover:bg-muted/70"
            key={item.key}
            onClick={item.onClick}
            type="button"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">{item.label}</span>
              <span className="font-medium">{item.count}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-muted">
              <div className="h-full rounded bg-primary/70" style={{ width: `${widthPercent}%` }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
