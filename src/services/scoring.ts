import { clamp } from "@/lib/utils";
import type { CriteriaHit } from "@/lib/types";

export type ScoreInput = {
  symbol: string;
  marketCap: number | null;
  avgDollarVol20d: number;

  // Optional later:
  // shortInterestPctFloat?: number | null;
  // daysToCover?: number | null;

  // News does NOT affect selection — handled separately.
};

export type ScoreOutput = {
  upsideScore: number;
  strongMatch: boolean;
  why: CriteriaHit[];
  notes: string[];
};

export function scoreUpside(input: ScoreInput, threshold = 75): ScoreOutput {
  const why: CriteriaHit[] = [];
  const notes: string[] = [];

  // Upside-focused MVP scoring (using only what we can reliably get in v1):
  // - liquidity (so moves are real and tradable)
  // - market cap gate ($500M)
  // Later add: short interest, ownership, re-rating, margin inflection, etc.

  // Gate: market cap >= 500M (or unknown allowed but noted)
  if (input.marketCap !== null && input.marketCap < 500_000_000) {
    return { upsideScore: 0, strongMatch: false, why: [], notes: ["Market cap below $500M gate"] };
  }

  // Liquidity score: $5M/day = baseline, more is better
  const liqScore = clamp((input.avgDollarVol20d / 5_000_000) * 50, 0, 100); // up to 100
  why.push({ label: "Liquidity", value: `$${Math.round(input.avgDollarVol20d).toLocaleString()}/day (20D avg)` });

  // Simple “starter” upsideScore = liquidityScore (placeholder).
  // This is intentionally minimal until you add short interest + ownership + valuation/fundamentals.
  const upsideScore = clamp(liqScore, 0, 100);

  if (upsideScore < threshold) notes.push("Below threshold (add short interest/ownership/fundamentals to improve signal)");

  return {
    upsideScore,
    strongMatch: upsideScore >= threshold,
    why,
    notes
  };
}
