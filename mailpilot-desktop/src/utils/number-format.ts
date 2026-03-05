export function formatPercent(value: number): string {
  const rounded = Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${value >= 0 ? "+" : ""}${rounded}%`;
}

export function formatSignedDelta(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}`;
}
