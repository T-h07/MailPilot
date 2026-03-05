type TooltipValueEntry = {
  dataKey?: string | number;
  value?: number | string;
};

type InsightsChartTooltipProps = {
  active?: boolean;
  payload?: readonly TooltipValueEntry[];
  label?: string | number;
  activeMetricLabel: string;
};

function formatDateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function InsightsChartTooltip({
  active,
  payload,
  label,
  activeMetricLabel,
}: InsightsChartTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const receivedValue = Number(payload.find((entry) => entry.dataKey === "received")?.value ?? 0);
  const secondaryEntry = payload.find((entry) => entry.dataKey !== "received");
  const secondaryValue = Number(secondaryEntry?.value ?? 0);

  return (
    <div className="rounded-md border border-border bg-card p-2 text-xs shadow-sm">
      <p className="font-medium">{formatDateLabel(String(label ?? ""))}</p>
      <p className="pt-1 text-muted-foreground">
        Received: <span className="font-semibold text-foreground">{receivedValue}</span>
      </p>
      <p className="text-muted-foreground">
        {activeMetricLabel}: <span className="font-semibold text-foreground">{secondaryValue}</span>
      </p>
    </div>
  );
}
