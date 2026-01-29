import type { CriteriaHit } from "@/lib/types";
import { clamp } from "@/lib/utils";

export type SwingInputs = {
  marketCap: number | null;
  avgDollarVol20d: number;

  rvol: number;
  bbWidth: number;
  atrPct: number;
  rsi14: number;

  aboveMA50: boolean;
  ma50AboveMA200: boolean;

  breakout20: boolean;
  breakout55: boolean;
};

export type SwingScore = {
  score: number;
  strongMatch: boolean;
  why: CriteriaHit[];
  notes: string[];
};

// ✅ MUST be exported (your build log complains it isn't)
export function scoreSwing(i: SwingInputs, threshold = 75): SwingScore {
  const why: CriteriaHit[] = [];
  const notes: string[] = [];

  // gates
  if (i.marketCap !== null && i.marketCap < 500_000_000) {
    return { score: 0, strongMatch: false, why: [], notes: ["Market cap < $500M (gate)"] };
  }
  if (i.avgDollarVol20d < 5_000_000) {
    return { score: 0, strongMatch: false, why: [], notes: ["Avg $ volume < $5M/day (gate)"] };
  }

  // Trend (0-20)
  let trend = 0;
  if (i.aboveMA50) trend += 10;
  if (i.ma50AboveMA200) trend += 10;
  if (trend >= 10) {
    why.push({ label: "Trend", value: `${trend}/20 (aboveMA50=${i.aboveMA50}, MA50>MA200=${i.ma50AboveMA200})` });
  }

  // Compression (0-20)
  const bbScore = clamp(((0.12 - i.bbWidth) / 0.12) * 12, 0, 12);
  const atrScore = clamp(((0.06 - i.atrPct) / 0.04) * 8, 0, 8);
  const squeeze = clamp(bbScore + atrScore, 0, 20);
  if (squeeze > 0) {
    why.push({
      label: "Compression",
      value: `${squeeze.toFixed(1)}/20 (BBWidth=${i.bbWidth.toFixed(3)}, ATR%=${(i.atrPct * 100).toFixed(2)}%)`
    });
  }

  // Breakout (0-25)
  let breakout = 0;
  if (i.breakout55) breakout = 25;
  else if (i.breakout20) breakout = 18;
  if (breakout > 0) {
    why.push({ label: "Breakout", value: `${breakout}/25 (20d=${i.breakout20}, 55d=${i.breakout55})` });
  }

  // Volume (0-25)
  const vol = clamp(((i.rvol - 1) / 1.5) * 25, 0, 25);
  if (vol > 0) {
    why.push({ label: "Volume", value: `${vol.toFixed(1)}/25 (RVOL=${i.rvol.toFixed(2)})` });
  }

  // Momentum (0-10)
  let mom = 0;
  if (i.rsi14 >= 55 && i.rsi14 <= 70) mom = 10;
  else if (i.rsi14 >= 50 && i.rsi14 < 55) mom = 6;
  else if (i.rsi14 > 70 && i.rsi14 <= 80) mom = 6;
  else if (i.rsi14 > 80) mom = 2;

  if (mom > 0) why.push({ label: "Momentum", value: `${mom}/10 (RSI14=${i.rsi14.toFixed(1)})` });

  const score = clamp(trend + squeeze + breakout + vol + mom, 0, 100);

  if (!i.breakout20 && squeeze < 10) notes.push("Not in breakout OR strong compression (less explosive setup)");
  if (i.rvol < 1.2) notes.push("Volume not elevated (watch for confirmation)");
  if (i.rsi14 < 50) notes.push("Weak momentum (RSI < 50)");

  return { score, strongMatch: score >= threshold, why, notes };
}
