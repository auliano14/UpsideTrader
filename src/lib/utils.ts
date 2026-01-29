export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function safeJsonParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function fmtMoney(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(n)) return "n/a";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(0)}`;
}
