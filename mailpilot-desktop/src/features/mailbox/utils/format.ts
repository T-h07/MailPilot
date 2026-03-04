import type { AccountColorToken } from "@/features/mailbox/model/types";

const relativeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const longDateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type RelativeTimeStep = {
  unit: Intl.RelativeTimeFormatUnit;
  divisor: number;
};

const relativeSteps: RelativeTimeStep[] = [
  { unit: "minute", divisor: 60 },
  { unit: "hour", divisor: 24 },
  { unit: "day", divisor: 7 },
  { unit: "week", divisor: 4.345 },
  { unit: "month", divisor: 12 },
];

export function formatRelativeTime(isoDate: string): string {
  const deltaSeconds = Math.floor((new Date(isoDate).getTime() - Date.now()) / 1000);
  let value = deltaSeconds;
  let unit: Intl.RelativeTimeFormatUnit = "second";

  for (const step of relativeSteps) {
    if (Math.abs(value) < step.divisor) {
      unit = step.unit;
      break;
    }
    value /= step.divisor;
    unit = step.unit;
  }

  return relativeFormatter.format(Math.round(value), unit);
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
