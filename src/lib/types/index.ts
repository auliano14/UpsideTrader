export type CriteriaHit = { label: string; value: string };

export type NewsSummary = {
  label: "Positive" | "Neutral" | "Negative";
  trend: "Improving" | "Stable" | "Worsening";
  score3d: number;
  score7d: number;
};

export type MatchRow = {
  symbol: string;
  name: string | null;
  sector: string | null;
  marketCap: number | null;
  avgDollarVol20d: number;
  upsideScore: number;
  strongMatch: boolean;
  why: CriteriaHit[];
  notes: string[];
  news: NewsSummary | null;
};
