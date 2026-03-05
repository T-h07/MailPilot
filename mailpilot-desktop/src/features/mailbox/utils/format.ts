import type { AccountColorToken } from "@/features/mailbox/model/types";

const relativeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const longDateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatRelativeTime(isoDate: string): string {
  const parsedMs = Date.parse(isoDate);
  if (Number.isNaN(parsedMs)) {
    return "Unknown time";
  }

  const deltaSeconds = Math.round((parsedMs - Date.now()) / 1000);
  const absoluteSeconds = Math.abs(deltaSeconds);

  if (absoluteSeconds < 60) {
    return relativeFormatter.format(deltaSeconds, "second");
  }

  const deltaMinutes = Math.round(deltaSeconds / 60);
  if (Math.abs(deltaMinutes) < 60) {
    return relativeFormatter.format(deltaMinutes, "minute");
  }

  const deltaHours = Math.round(deltaMinutes / 60);
  if (Math.abs(deltaHours) < 24) {
    return relativeFormatter.format(deltaHours, "hour");
  }

  const deltaDays = Math.round(deltaHours / 24);
  if (Math.abs(deltaDays) < 7) {
    return relativeFormatter.format(deltaDays, "day");
  }

  const deltaWeeks = Math.round(deltaDays / 7);
  if (Math.abs(deltaWeeks) < 5) {
    return relativeFormatter.format(deltaWeeks, "week");
  }

  const deltaMonths = Math.round(deltaDays / 30.4375);
  if (Math.abs(deltaMonths) < 12) {
    return relativeFormatter.format(deltaMonths, "month");
  }

  const deltaYears = Math.round(deltaDays / 365.25);
  return relativeFormatter.format(deltaYears, "year");
}

export function formatLongDate(isoDate: string): string {
  return longDateFormatter.format(new Date(isoDate));
}

export function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = sizeBytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

export function accountPillClasses(colorToken: AccountColorToken): string {
  switch (colorToken) {
    case "emerald":
      return "border-emerald-300/60 bg-emerald-100/80 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100";
    case "violet":
      return "border-violet-300/60 bg-violet-100/80 text-violet-900 dark:border-violet-700 dark:bg-violet-900/40 dark:text-violet-100";
    case "amber":
      return "border-amber-300/60 bg-amber-100/80 text-amber-900 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-100";
    case "sky":
    default:
      return "border-sky-300/70 bg-sky-100/80 text-sky-900 dark:border-sky-700 dark:bg-sky-900/40 dark:text-sky-100";
  }
}
