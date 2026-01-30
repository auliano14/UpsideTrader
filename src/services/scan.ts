import * as polygon from "@/services/polygonClient";
import { ingestNewsForTicker, getNewsSummary } from "@/services/news";
import type { MatchRow } from "@/lib/types";
import { subDays, formatISO } from "date-fns";
import {
  avgDollarVol20d,
  atrPct,
  bollingerWidth,
  breakoutHigh,
  rsi,
  rvolToday,
  sma,
  type Candle
} from "@/lib/indicators";
import { scoreSwing } from "@/services/scoring";

function isoDate(d: Date) {
  return formatISO(d, { representation: "date" });
}

function toCandles(polyResults: any[]): Candle[] {
  return polyResults.map(r => ({
    t: Number(r.t),
    o: Number(r.o),
    h: Number(r.h),
    l: Number(r.l),
    c: Number(r.c),
    v: Number(r.v),
    vw: r.vw ? Number(r.vw) : undefined
  }));
}

export async function runScan(params: {
  scoreThreshold: number;
  maxTickers: number;
}): Promise<MatchRow[]> {
  const tickersResp = await polygon.listTickers(1000);
  const tickers: any[] = tickersResp?.results ?? [];

  const symbols = tickers
    .map(t => String(t.ticker))
    .filter(Boolean)
    .slice(0, params.maxTickers);

  const from = isoDate(subDays(new Date(), 260));
  const to = isoDate(subDays(new Date(), 1));

  console.log("SCAN: symbols =", symbols.length, symbols.slice(0, 10));

  const matches: MatchRow[] = [];

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];

    // --- overview ---
    let overview: any;
    try {
      overview = await polygon.tickerOverview(symbol);
    } catch {
      continue;
    }

    const r = overview?.results;
    const name: string | null = r?.name ?? null;
    const marketCap: number | null = r?.market_cap ?? null;

    // --- candles ---
    let aggs: any;
    try {
      aggs = await polygon.aggsDailyRange(symbol, from, to);
    } catch {
      continue;
    }

    const raw: any[] = aggs?.results ?? [];
    if (raw.length < 60) continue;

    const candles = toCandles(raw);
    const closes = candles.map(c => c.c);

    const adv20 = avgDollarVol20d(candles);
    const rvol = rvolToday(candles) ?? 0;

    const ma50 = sma(closes, 50);
    const ma200 = sma(closes, 200);
    const aboveMA50 = ma50 !== null ? closes.at(-1)! > ma50 : false;
    const ma50AboveMA200 = ma50 !== null && ma200 !== null ? ma50 > ma200 : false;

    const rsi14 = rsi(closes, 14) ?? 0;
    const atr = atrPct(candles, 14) ?? 0;
    const bbW = bollingerWidth(closes, 20, 2) ?? 0;

    const breakout20 = breakoutHigh(candles, 20);
    const breakout55 = breakoutHigh(candles, 55);

    const scored = scoreSwing(
      {
        marketCap,
        avgDollarVol20d: adv20,
        rvol,
        bbWidth: bbW,
        atrPct: atr,
        rsi14,
        aboveMA50,
        ma50AboveMA200,
        breakout20,
        breakout55
      },
      params.scoreThreshold
    );

    if (!scored.strongMatch) continue;

    // --- news (optional, informational only) ---
    let newsSummary = null;
    try {
      await ingestNewsForTicker(symbol);
      newsSummary = await getNewsSummary(symbol);
    } catch {
      newsSummary = null;
    }

    matches.push({
      symbol,
      name,
      marketCap,

      upsideScore: scored.score,
      strongMatch: true,

      avgDollarVol20d: adv20,
      rvol,
      bbWidth: bbW,
      atrPct: atr,
      rsi14,
      aboveMA50,
      ma50AboveMA200,
      breakout20,
      breakout55,

      why: scored.why,
      notes: scored.notes,
      news: newsSummary
    });
  }

  matches.sort((a, b) => b.upsideScore - a.upsideScore);
  console.log("SCAN: matches found =", matches.length);

  return matches;
}
