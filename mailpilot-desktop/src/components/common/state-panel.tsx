import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, Inbox, Info, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StatePanelVariant = "loading" | "empty" | "error" | "info" | "success";

type StatePanelProps = {
  variant?: StatePanelVariant;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
  centered?: boolean;
  compact?: boolean;
  className?: string;
};

const VARIANT_STYLES: Record<StatePanelVariant, string> = {
  loading: "border-sky-500/25 bg-sky-500/10",
  empty: "border-border/80 bg-card/80",
  error: "border-destructive/35 bg-destructive/10",
  info: "border-border/80 bg-card/90",
  success: "border-emerald-500/30 bg-emerald-500/10",
};

const VARIANT_ICON_STYLES: Record<StatePanelVariant, string> = {
  loading: "text-sky-300",
  empty: "text-muted-foreground",
  error: "text-destructive",
  info: "text-sky-300",
  success: "text-emerald-300",
};

const DEFAULT_ICONS: Record<StatePanelVariant, LucideIcon> = {
  loading: Loader2,
  empty: Inbox,
  error: AlertTriangle,
  info: Info,
  success: CheckCircle2,
};

export function StatePanel({
  variant = "info",
  title,
  description,
  actions,
  icon,
  centered = false,
  compact = false,
  className,
}: StatePanelProps) {
  const Icon = icon ?? DEFAULT_ICONS[variant];

  return (
    <Card
      className={cn(
        "overflow-hidden border shadow-none",
        VARIANT_STYLES[variant],
        centered && "h-full",
        className
      )}
    >
      <div
        className={cn(
          "flex gap-3",
          compact ? "p-4" : "p-5",
          centered && "h-full items-center justify-center text-center"
        )}
      >
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-background/60",
            VARIANT_ICON_STYLES[variant],
            centered && "mt-0"
          )}
        >
          <Icon className={cn("h-4 w-4", variant === "loading" && "animate-spin")} />
        </div>
        <div className={cn("min-w-0", centered && "max-w-md")}>
          <p className="text-sm font-semibold tracking-tight">{title}</p>
          {description ? (
            <div className="pt-1 text-sm text-muted-foreground">{description}</div>
          ) : null}
          {actions ? <div className="flex flex-wrap gap-2 pt-3">{actions}</div> : null}
        </div>
      </div>
    </Card>
  );
}
