import { prisma } from "@/lib/prisma";
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
  maxTickers: number;     // dev guard
}): Promise<MatchRow[]> {
  const tickersResp = await polygon.listTickers(1000);
  const tickers: any[] = tickersResp?.results ?? [];

  const symbols = tickers
    .map(t => String(t.ticker))
    .filter(Boolean)
    .slice(0, params.maxTickers);

  // Need enough lookback for MA200 + ATR + BB + RSI
  const from = isoDate(subDays(new Date(), 260));
  const to = isoDate(subDays(new Date(), 1));

  // ✅ DEBUG LOGS
  console.log("SCAN: tickersResp.results =", tickers.length);
  console.log("SCAN: symbols =", symbols.length, "first10 =", symbols.slice(0, 10));
  console.log("SCAN: from/to =", from, to, "threshold =", params.scoreThreshold);

  const matches: MatchRow[] = [];

  // ✅ indexed loop so we can log first few tickers safely
  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];

    // overview for name + market cap (Starter usually allows this)
    let overview: any;
    try {
      overview = await polygon.tickerOverview(symbol);
    } catch {
      if (i < 5) console.log("SCAN:", symbol, "overview fetch failed");
      continue;
    }
    const r = overview?.results;
    const name: string | null = r?.name ?? null;
    const marketCap: number | null = r?.market_cap ?? null;

    if (i < 5) console.log("SCAN:", symbol, "marketCap =", marketCap, "name =", name);

    // price candles
    let aggs: any;
    try {
      aggs = await polygon.aggsDailyRange(symbol, from, to);
    } catch {
      if (i < 5) console.log("SCAN:", symbol, "aggs fetch failed");
      continue;
    }

    const raw: any[] = aggs?.results ?? [];
    if (i < 5) console.log("SCAN:", symbol, "raw candles =", raw.length);

    // ✅ TEMP DEBUG: 210 filters out too much; lower to confirm pipeline works
    if (raw.length < 60) continue;

    const candles = toCandles(raw);
    const closes = candles.map(c => c.c);

    const adv20 = avgDollarVol20d(candles);
    const rvol = rvolToday(candles) ?? 0;

    // indicators
    const ma50 = sma(closes, 50);
    const ma200 = sma(closes, 200);
    const aboveMA50 = ma50 !== null ? closes[closes.length - 1] > ma50 : false;
    const ma50AboveMA200 = ma50 !== null && ma200 !== null ? ma50 > ma200 : false;

    const rsi14 = rsi(closes, 14) ?? 0;
    const atr = atrPct(candles, 14) ?? 0;
    const bbW = bollingerWidth(closes, 20, 2) ?? 0;

    const breakout20 = breakoutHigh(candles, 20);
    const breakout55 = breakoutHigh(candles, 55);

    // score
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

    if (i < 5) {
      console.log(
        "SCAN:", symbol,
        "adv20 =", adv20.toFixed(0),
        "rvol =", rvol.toFixed(2),
        "bbW =", bbW.toFixed(3),
        "atrPct =", (atr * 100).toFixed(2) + "%",
        "rsi14 =", rsi14.toFixed(1),
        "break20 =", breakout20,
        "break55 =", breakout55,
        "score =", scored.score.toFixed(1),
        "strong =", scored.strongMatch
      );
    }

    // persist ticker
    const dbTicker = await prisma.ticker.upsert({
      where: { symbol },
      update: { name, marketCap },
      create: { symbol, name, marketCap }
    });

    // ingest news (informational only)
    let newsSummary = null;
    try {
      await ingestNewsForTicker(symbol);
      newsSummary = await getNewsSummary(symbol);
    } catch {
      // ignore if news blocked/unavailable
      newsSummary = null;
    }

    // snapshot
    await prisma.metricsSnapshot.create({
      data: {
        tickerId: dbTicker.id,
        upsideScore: scored.score,
        strongMatch: scored.strongMatch,

        avgDollarVol20d: adv20,
        rvol,
        bbWidth: bbW,
        atrPct: atr,
        rsi14,
        aboveMA50,
        ma50AboveMA200,
        breakout20,
        breakout55,

        newsLabel: newsSummary?.label ?? null,
        newsTrend: newsSummary?.trend ?? null,
        newsScore3d: newsSummary?.score3d ?? null,
        newsScore7d: newsSummary?.score7d ?? null,

        metCriteriaJson: JSON.stringify(scored.why),
        notesJson: JSON.stringify(scored.notes)
      }
    });

    if (scored.strongMatch) {
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
  }

  console.log("SCAN: matches found =", matches.length);

  matches.sort((a, b) => b.upsideScore - a.upsideScore);
  return matches;
}

export async function refreshTracked(scoreThreshold = 75): Promise<number> {
  const watch = await prisma.watchlistItem.findMany({ include: { ticker: true } });
  if (!watch.length) return 0;

  const from = isoDate(subDays(new Date(), 260));
  const to = isoDate(subDays(new Date(), 1));

  for (const w of watch) {
    const symbol = w.ticker.symbol;

    let overview: any;
    try {
      overview = await polygon.tickerOverview(symbol);
    } catch {
      continue;
    }
    const marketCap: number | null = overview?.results?.market_cap ?? w.ticker.marketCap ?? null;

    let aggs: any;
    try {
      aggs = await polygon.aggsDailyRange(symbol, from, to);
    } catch {
      continue;
    }
    const raw: any[] = aggs?.results ?? [];

    // ✅ TEMP DEBUG: lower from 210 to 60 so tracked tickers don’t get skipped
    if (raw.length < 60) continue;

    const candles = toCandles(raw);
    const closes = candles.map(c => c.c);

    const adv20 = avgDollarVol20d(candles);
    const rvol = rvolToday(candles) ?? 0;

    const ma50 = sma(closes, 50);
    const ma200 = sma(closes, 200);
    const aboveMA50 = ma50 !== null ? closes[closes.length - 1] > ma50 : false;
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
      scoreThreshold
    );

    // news (info only)
    let newsSummary = null;
    try {
      await ingestNewsForTicker(symbol);
      newsSummary = await getNewsSummary(symbol);
    } catch {
      newsSummary = null;
    }

    await prisma.metricsSnapshot.create({
      data: {
        tickerId: w.ticker.id,
        upsideScore: scored.score,
        strongMatch: scored.strongMatch,

        avgDollarVol20d: adv20,
        rvol,
        bbWidth: bbW,
        atrPct: atr,
        rsi14,
        aboveMA50,
        ma50AboveMA200,
        breakout20,
        breakout55,

        newsLabel: newsSummary?.label ?? null,
        newsTrend: newsSummary?.trend ?? null,
        newsScore3d: newsSummary?.score3d ?? null,
        newsScore7d: newsSummary?.score7d ?? null,

        metCriteriaJson: JSON.stringify(scored.why),
        notesJson: JSON.stringify(scored.notes)
      }
    });

    // auto-trigger if threshold crossed
    if (w.status === "On Watch" && scored.strongMatch) {
      await prisma.watchlistItem.update({ where: { id: w.id }, data: { status: "Triggered" } });
    }
  }

  return watch.length;
}
