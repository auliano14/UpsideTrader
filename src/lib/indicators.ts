export type Candle = {
  t: number; // ms epoch
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

export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = values.length - period; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function atrPct(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;

  const trs: number[] = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    const cur = candles[i];
    const prevClose = candles[i - 1].c;
    const tr = Math.max(
      cur.h - cur.l,
      Math.abs(cur.h - prevClose),
      Math.abs(cur.l - prevClose)
    );
    trs.push(tr);
  }

  const atr = trs.reduce((a, b) => a + b, 0) / period;
  const lastClose = candles[candles.length - 1].c;
  if (lastClose <= 0) return null;
  return atr / lastClose;
}

export function bollingerWidth(values: number[], period = 20, stdevMult = 2): number | null {
  if (values.length < period) return null;

  const slice = values.slice(values.length - period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
  const stdev = Math.sqrt(variance);

  const upper = mean + stdevMult * stdev;
  const lower = mean - stdevMult * stdev;
  if (mean === 0) return null;
  return (upper - lower) / mean;
}

export function avgDollarVol20d(candles: Candle[]): number {
  const last = candles.slice(-20);
  if (!last.length) return 0;
  const sum = last.reduce((acc, c) => acc + (c.v * (c.vw ?? c.c)), 0);
  return sum / last.length;
}

export function rvolToday(candles: Candle[]): number | null {
  if (candles.length < 21) return null;
  const last = candles[candles.length - 1];
  const prior20 = candles.slice(-21, -1);
  const avgVol = prior20.reduce((a, b) => a + b.v, 0) / prior20.length;
  if (avgVol === 0) return null;
  return last.v / avgVol;
}

export function breakoutHigh(candles: Candle[], lookback: number): boolean {
  if (candles.length < lookback + 1) return false;
  const lastClose = candles[candles.length - 1].c;
  const prior = candles.slice(candles.length - lookback - 1, candles.length - 1);
  const priorHigh = Math.max(...prior.map(c => c.h));
  return lastClose > priorHigh;
}
