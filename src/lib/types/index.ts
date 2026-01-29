export type CriteriaHit = { label: string; value: string };

export type MatchRow = {
  symbol: string;
  name: string | null;
  marketCap: number | null;

  upsideScore: number;
  strongMatch: boolean;

  avgDollarVol20d: number;

  close: number;
  sma50: number | null;
  sma200: number | null;
  atrPct: number | null;
  rvol: number | null;
  baseTight: number | null;
  breakout: boolean;

  why: CriteriaHit[];
  notes: string[];
  tags: string[];
};

