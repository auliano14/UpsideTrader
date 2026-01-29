import { prisma } from "@/lib/prisma";
import { scoreUpside } from "@/services/scoring";
import { ingestNewsForTicker, getNewsSummary } from "@/services/news";
import * as polygon from "@/services/polygonClient";
import type { MatchRow } from "@/lib/types";
import { subDays, formatISO } from "date-fns";

function isoDate(d: Date) {
  return formatISO(d, { representation: "date" });
}

function computeAvgDollarVol20(candles: any[]) {
  const last = candles.slice(-20);
  if (!last.length) return 0;
  const sum = last.reduce((acc, c) => acc + (Number(c.v) * Number(c.vw || c.c)), 0);
  return sum / last.length;
}

export async function runScan(params: {
  scoreThreshold: number;
  minDollarVol20d: number;
  maxTickers: number; // dev guard
}): Promise<MatchRow[]> {
  const tickersResp = await polygon.listTickers(1000);
  const tickers: any[] = tickersResp?.results ?? [];

  const symbols = tickers
    .map(t => String(t.ticker))
    .filter(Boolean)
    .slice(0, params.maxTickers);

  const from = isoDate(subDays(new Date(), 30));
  const to = isoDate(subDays(new Date(), 1));

  const matches: MatchRow[] = [];

  for (const symbol of symbols) {
    // metadata
    let overview: any;
    try {
      overview = await polygon.tickerOverview(symbol);
    } catch {
      continue;
    }
    const r = overview?.results;
    const marketCap: number | null = r?.market_cap ?? null;
    const name: string | null = r?.name ?? null;
    const sector: string | null = r?.sic_description ?? null;

    // price candles -> liquidity
    let aggs: any;
    try {
      aggs = await polygon.aggsDailyRange(symbol, from, to);
    } catch {
      continue;
    }
    const candles: any[] = aggs?.results ?? [];
    if (candles.length < 10) continue;

    const avgDollarVol20d = computeAvgDollarVol20(candles);
    if (avgDollarVol20d < params.minDollarVol20d) continue;

    // scoring (news NOT included in criteria)
    const scored = scoreUpside(
      { symbol, marketCap, avgDollarVol20d },
      params.scoreThreshold
    );

    // persist ticker
    const dbTicker = await prisma.ticker.upsert({
      where: { symbol },
      update: { name, sector, marketCap },
      create: { symbol, name, sector, marketCap }
    });

    // ingest news + sentiment (informational)
    try {
      await ingestNewsForTicker(symbol);
    } catch {
      // ignore if plan blocks / endpoint fails
    }
    const newsSummary = await getNewsSummary(symbol);

    // store snapshot
    await prisma.metricsSnapshot.create({
      data: {
        tickerId: dbTicker.id,
        upsideScore: scored.upsideScore,
        strongMatch: scored.strongMatch,
        avgDollarVol20d,
        marketCap,
        metCriteriaJson: JSON.stringify(scored.why),
        notesJson: JSON.stringify(scored.notes),
        newsLabel: newsSummary?.label ?? null,
        newsTrend: newsSummary?.trend ?? null,
        newsScore3d: newsSummary?.score3d ?? null,
        newsScore7d: newsSummary?.score7d ?? null
      }
    });

    if (scored.strongMatch) {
      matches.push({
        symbol,
        name,
        sector,
        marketCap,
        avgDollarVol20d,
        upsideScore: scored.upsideScore,
        strongMatch: true,
        why: scored.why,
        notes: scored.notes,
        news: newsSummary
      });
    }
  }

  matches.sort((a, b) => b.upsideScore - a.upsideScore);
  return matches;
}

export async function refreshTracked(scoreThreshold = 75): Promise<number> {
  const watch = await prisma.watchlistItem.findMany({ include: { ticker: true } });
  if (!watch.length) return 0;

  const from = isoDate(subDays(new Date(), 30));
  const to = isoDate(subDays(new Date(), 1));

  for (const w of watch) {
    const symbol = w.ticker.symbol;

    // refresh news
    try { await ingestNewsForTicker(symbol); } catch {}
    const newsSummary = await getNewsSummary(symbol);

    // refresh liquidity
    let aggs: any;
    try {
      aggs = await polygon.aggsDailyRange(symbol, from, to);
    } catch {
      continue;
    }
    const candles: any[] = aggs?.results ?? [];
    const avgDollarVol20d = computeAvgDollarVol20(candles);

    const scored = scoreUpside(
      { symbol, marketCap: w.ticker.marketCap ?? null, avgDollarVol20d },
      scoreThreshold
    );

    await prisma.metricsSnapshot.create({
      data: {
        tickerId: w.ticker.id,
        upsideScore: scored.upsideScore,
        strongMatch: scored.strongMatch,
        avgDollarVol20d,
        marketCap: w.ticker.marketCap ?? null,
        metCriteriaJson: JSON.stringify(scored.why),
        notesJson: JSON.stringify(scored.notes),
        newsLabel: newsSummary?.label ?? null,
        newsTrend: newsSummary?.trend ?? null,
        newsScore3d: newsSummary?.score3d ?? null,
        newsScore7d: newsSummary?.score7d ?? null
      }
    });

    // auto-trigger example: crosses threshold
    if (w.status === "On Watch" && scored.strongMatch) {
      await prisma.watchlistItem.update({ where: { id: w.id }, data: { status: "Triggered" } });
    }
  }

  return watch.length;
}
