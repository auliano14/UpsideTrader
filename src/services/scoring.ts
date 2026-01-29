import type { CriteriaHit } from "@/lib/types";
import { clamp } from "@/lib/utils";

export type SwingInputs = {
  marketCap: number | null;
  avgDollarVol20d: number;

  close: number;
  sma50: number | null;
  sma200: number | null;

  atrPct: number | null;      // ATR14 / close
  rvol: number | null;        // volume today / avg volume 20
  baseTight: number | null;   // last 15d range / close
  breakout: boolean;          // close > 55d high (excluding today)
};

export type SwingScore = {
  upsideScore: number;
  strongMatch: boolean;
  why: CriteriaHit[];
  notes: string[];
  tags: string[];
};

export function scoreUpsideSwing(x: SwingInputs, threshold = 75): SwingScore {
  const why: CriteriaHit[] = [];
  const notes: string[] = [];
  const tags: string[] = [];

  // Hard gate: market cap >= 500M if known
  if (x.marketCap !== null && x.marketCap < 500_000_000) {
    return { upsideScore: 0, strongMatch: false, why: [], notes: ["Market cap below $500M gate"], tags: [] };
  }

  // Gate: liquidity baseline (still score it too)
  if (x.avgDollarVol20d < 5_000_000) {
    return { upsideScore: 0, strongMatch: false, why: [], notes: ["Liquidity below $5M/day gate"], tags: [] };
  }

  // Trend score (0-25)
  let trend = 0;
  if (x.sma50 !== null && x.close > x.sma50) trend += 12.5;
  if (x.sma200 !== null && x.close > x.sma200) trend += 12.5;

  if (x.sma50 !== null) why.push({ label: "Close vs SMA50", value: x.close > x.sma50 ? "Above" : "Below" });
  if (x.sma200 !== null) why.push({ label: "Close vs SMA200", value: x.close > x.sma200 ? "Above" : "Below" });

  if (trend >= 20) tags.push("Trend Aligned");

  // Volatility contraction score (0-20)
  // We want ATR% low-ish. Typical “tight” might be < 3–4% depending on name.
  let vol = 0;
  if (x.atrPct !== null) {
    if (x.atrPct <= 0.03) vol = 20;
    else if (x.atrPct <= 0.04) vol = 14;
    else if (x.atrPct <= 0.05) vol = 8;
    else vol = 0;

    why.push({ label: "ATR% (14)", value: `${(x.atrPct * 100).toFixed(2)}%` });
    if (x.atrPct <= 0.04) tags.push("Volatility Compressed");
  } else {
    notes.push("ATR unavailable (not enough candles)");
  }

  // Base tightness (0-15)
  let base = 0;
  if (x.baseTight !== null) {
    // 15-day range %: <8% tight, <6% very tight
    if (x.baseTight <= 0.06) base = 15;
    else if (x.baseTight <= 0.08) base = 10;
    else if (x.baseTight <= 0.10) base = 5;
    else base = 0;

    why.push({ label: "Base tightness (15D)", value: `${(x.baseTight * 100).toFixed(2)}%` });
    if (x.baseTight <= 0.08) tags.push("Tight Base");
  } else {
    notes.push("Base tightness unavailable (not enough candles)");
  }

  // Breakout trigger (0-25)
  let brk = x.breakout ? 25 : 0;
  if (x.breakout) tags.push("Breakout");
  why.push({ label: "55D breakout", value: x.breakout ? "Yes" : "No" });

  // Relative volume (0-15)
  let rv = 0;
  if (x.rvol !== null) {
    if (x.rvol >= 2.0) rv = 15;
    else if (x.rvol >= 1.5) rv = 10;
    else if (x.rvol >= 1.2) rv = 6;
    else rv = 0;

    why.push({ label: "RVOL (vs 20D)", value: `${x.rvol.toFixed(2)}x` });
    if (x.rvol >= 1.5) tags.push("Demand Spike");
  } else {
    notes.push("RVOL unavailable (not enough candles)");
  }

  // Liquidity score (bonus 0-10)
  const liq = clamp((x.avgDollarVol20d / 5_000_000) * 5, 0, 10);
  why.push({ label: "Avg $ vol (20D)", value: `$${Math.round(x.avgDollarVol20d).toLocaleString()}/day` });

  const raw = trend + vol + base + brk + rv + liq;
  const upsideScore = clamp(raw, 0, 100);

  // Strong match logic: you asked for “as many as match”
  // This ensures we only return names with real swing structure.
  const strongMatch =
    upsideScore >= threshold &&
    (x.breakout || (trend >= 20 && vol >= 14 && base >= 10 && (x.rvol ?? 0) >= 1.2));

  if (!strongMatch) notes.push("Did not meet strong-match structure (breakout OR tight+trend+volume)");

  return { upsideScore, strongMatch, why, notes, tags };
}
