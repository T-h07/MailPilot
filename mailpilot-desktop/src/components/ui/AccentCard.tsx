import * as React from "react";
import { cn } from "@/lib/utils";

export type AccentColor = "blue" | "gold" | "purple" | "orange" | "red" | "green";

type AccentToneStyles = {
  line: string;
  glow: string;
  gradient: string;
};

const ACCENT_STYLES: Record<AccentColor, AccentToneStyles> = {
  blue: {
    line: "bg-sky-500/75",
    glow: "bg-sky-500/16",
    gradient: "from-sky-500/[0.10] via-transparent to-transparent",
  },
  gold: {
    line: "bg-yellow-500/75",
    glow: "bg-yellow-500/16",
    gradient: "from-yellow-500/[0.11] via-transparent to-transparent",
  },
  purple: {
    line: "bg-violet-500/75",
    glow: "bg-violet-500/16",
    gradient: "from-violet-500/[0.10] via-transparent to-transparent",
  },
  orange: {
    line: "bg-amber-500/75",
    glow: "bg-amber-500/16",
    gradient: "from-amber-500/[0.11] via-transparent to-transparent",
  },
  red: {
    line: "bg-red-500/75",
    glow: "bg-red-500/16",
    gradient: "from-red-500/[0.11] via-transparent to-transparent",
  },
  green: {
    line: "bg-emerald-500/75",
    glow: "bg-emerald-500/16",
    gradient: "from-emerald-500/[0.11] via-transparent to-transparent",
  },
};

type AccentCardProps = React.HTMLAttributes<HTMLDivElement> & {
  accent?: AccentColor;
  heading?: React.ReactNode;
  description?: React.ReactNode;
  headerRight?: React.ReactNode;
  contentClassName?: string;
};

export function AccentCard({
  accent = "blue",
  children,
  className,
  heading,
  description,
  headerRight,
  contentClassName,
  ...props
}: AccentCardProps) {
  const styles = ACCENT_STYLES[accent];
  const hasHeader = heading !== undefined || description !== undefined || headerRight !== undefined;

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm",
        className
      )}
      {...props}
    >
      <div className="pointer-events-none absolute inset-0">
        <div className={cn("absolute inset-0 bg-gradient-to-br", styles.gradient)} />
        <div className={cn("absolute inset-x-0 top-0 h-[2px]", styles.line)} />
        <div
          className={cn("absolute -top-8 left-8 h-16 w-36 rounded-full blur-2xl", styles.glow)}
        />
      </div>

      <div className="relative">
        {hasHeader && (
          <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
            <div>
              {heading !== undefined && (
                <p className="font-semibold leading-none tracking-tight">{heading}</p>
              )}
              {description !== undefined && (
                <p className="pt-1 text-sm text-muted-foreground">{description}</p>
              )}
            </div>
            {headerRight}
          </div>
        )}
        <div className={cn(hasHeader ? "px-5 pb-5" : "p-5", contentClassName)}>{children}</div>
      </div>
    </section>
  );
}
