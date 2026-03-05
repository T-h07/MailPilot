export const ACCENT_TOKENS = [
  "gold",
  "purple",
  "blue",
  "green",
  "red",
  "orange",
  "pink",
  "teal",
  "gray",
] as const;

export type AccentToken = (typeof ACCENT_TOKENS)[number];

export type AccentClasses = {
  border: string;
  stripe: string;
  badge: string;
  text: string;
};

const ACCENT_CLASSES: Record<AccentToken, AccentClasses> = {
  gold: {
    border: "border-yellow-500/70",
    stripe: "bg-yellow-500/85",
    badge: "border-yellow-500/45 bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
    text: "text-yellow-700 dark:text-yellow-300",
  },
  purple: {
    border: "border-violet-500/70",
    stripe: "bg-violet-500/85",
    badge: "border-violet-500/45 bg-violet-500/15 text-violet-700 dark:text-violet-300",
    text: "text-violet-700 dark:text-violet-300",
  },
  blue: {
    border: "border-blue-500/70",
    stripe: "bg-blue-500/85",
    badge: "border-blue-500/45 bg-blue-500/15 text-blue-700 dark:text-blue-300",
    text: "text-blue-700 dark:text-blue-300",
  },
  green: {
    border: "border-emerald-500/70",
    stripe: "bg-emerald-500/85",
    badge: "border-emerald-500/45 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  red: {
    border: "border-rose-500/70",
    stripe: "bg-rose-500/85",
    badge: "border-rose-500/45 bg-rose-500/15 text-rose-700 dark:text-rose-300",
    text: "text-rose-700 dark:text-rose-300",
  },
  orange: {
    border: "border-orange-500/70",
    stripe: "bg-orange-500/85",
    badge: "border-orange-500/45 bg-orange-500/15 text-orange-700 dark:text-orange-300",
    text: "text-orange-700 dark:text-orange-300",
  },
  pink: {
    border: "border-pink-500/70",
    stripe: "bg-pink-500/85",
    badge: "border-pink-500/45 bg-pink-500/15 text-pink-700 dark:text-pink-300",
    text: "text-pink-700 dark:text-pink-300",
  },
  teal: {
    border: "border-teal-500/70",
    stripe: "bg-teal-500/85",
    badge: "border-teal-500/45 bg-teal-500/15 text-teal-700 dark:text-teal-300",
    text: "text-teal-700 dark:text-teal-300",
  },
  gray: {
    border: "border-slate-500/70",
    stripe: "bg-slate-500/85",
    badge: "border-slate-500/45 bg-slate-500/15 text-slate-700 dark:text-slate-300",
    text: "text-slate-700 dark:text-slate-300",
  },
};

const FALLBACK_ACCENT: AccentToken = "gray";

function toAccentToken(accent: string | null | undefined): AccentToken {
  if (!accent) {
    return FALLBACK_ACCENT;
  }
  const normalized = accent.trim().toLowerCase() as AccentToken;
  return normalized in ACCENT_CLASSES ? normalized : FALLBACK_ACCENT;
}

export function getAccentClasses(accent: string | null | undefined): AccentClasses {
  return ACCENT_CLASSES[toAccentToken(accent)];
}
