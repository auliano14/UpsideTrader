export type Candle = {
  t: number; // timestamp ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw?: number;
};

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(values.length - period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

export function atr(candles: Candle[], period: number): number | null {
  if (candles.length < period + 1) return null;

  // True Range = max(high-low, abs(high-prevClose), abs(low-prevClose))
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      cur.h - cur.l,
      Math.abs(cur.h - prev.c),
      Math.abs(cur.l - prev.c)
    );
    trs.push(tr);
  }
  if (trs.length < period) return null;

  // Simple ATR (SMA of TR). Good enough for scanner.
  const last = trs.slice(trs.length - period);
  return last.reduce((a, b) => a + b, 0) / period;
}

export function avg(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function baseTightnessPct(candles: Candle[], lookback: number): number | null {
  if (candles.length < lookback) return null;
  const slice = candles.slice(candles.length - lookback);
  const high = Math.max(...slice.map(x => x.h));
  const low = Math.min(...slice.map(x => x.l));
  const lastClose = slice[slice.length - 1].c;
  if (lastClose <= 0) return null;
  return (high - low) / lastClose; // e.g. 0.06 = 6% range
}

export function highestHigh(candles: Candle[], lookback: number, excludeLast = true): number | null {
  if (candles.length < lookback + (excludeLast ? 1 : 0)) return null;
  const end = excludeLast ? candles.length - 1 : candles.length;
  const slice = candles.slice(Math.max(0, end - lookback), end);
  if (!slice.length) return null;
  return Math.max(...slice.map(x => x.h));
}

export function rvol(candles: Candle[], lookbackVol = 20): number | null {
  if (candles.length < lookbackVol + 1) return null;
  const today = candles[candles.length - 1].v;
  const prior = candles.slice(candles.length - 1 - lookbackVol, candles.length - 1);
  const avgVol = avg(prior.map(x => x.v));
  if (avgVol <= 0) return null;
  return today / avgVol;
}

export function avgDollarVol(candles: Candle[], lookback = 20): number {
  const slice = candles.slice(Math.max(0, candles.length - lookback));
  if (!slice.length) return 0;
  // use v * vw when available else v * c
  const dollars = slice.map(c => c.v * (c.vw ?? c.c));
  return avg(dollars);
}
