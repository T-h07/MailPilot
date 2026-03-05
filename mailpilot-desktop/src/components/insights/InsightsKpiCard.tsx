import type { AccentColor } from "@/components/ui/AccentCard";
import { AccentCard } from "@/components/ui/AccentCard";

type InsightsKpiCardProps = {
  accent: AccentColor;
  label: string;
  value: string;
  subtitle: string;
  delta: string;
};

export function InsightsKpiCard({
  accent,
  label,
  value,
  subtitle,
  delta,
}: InsightsKpiCardProps) {
  return (
    <AccentCard
      accent={accent}
      className="h-full"
      contentClassName="space-y-0 p-4"
      heading={(
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      )}
    >
      <p className="text-2xl font-semibold leading-none">{value}</p>
      <p className="pt-2 text-xs text-muted-foreground">{subtitle}</p>
      <p className="pt-1 text-xs font-medium text-foreground/80">{delta}</p>
    </AccentCard>
  );
}
