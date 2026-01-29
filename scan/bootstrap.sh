#!/usr/bin/env bash
set -euo pipefail

APP_NAME="upside-swing-screener"

echo "==> Creating Next.js app: ${APP_NAME}"
if [ -d "${APP_NAME}" ]; then
  echo "Directory ${APP_NAME} already exists. Remove it or change APP_NAME."
  exit 1
fi

npx create-next-app@latest "${APP_NAME}" \
  --ts --eslint --tailwind --app --src-dir --import-alias "@/*" --no-turbo

cd "${APP_NAME}"

echo "==> Installing dependencies"
npm i prisma @prisma/client zod node-cron vader-sentiment date-fns
npm i -D ts-node

echo "==> Initializing Prisma"
npx prisma init --datasource-provider sqlite

echo "==> Writing .env.example"
cat > .env.example << 'EOF'
# Required
POLYGON_API_KEY="YOUR_POLYGON_KEY"
DATABASE_URL="file:./dev.db"

# Optional: when you later deploy, you can switch to Postgres
# DATABASE_URL="postgresql://user:pass@host:5432/db"
EOF

echo "==> Writing Prisma schema"
cat > prisma/schema.prisma << 'EOF'
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Ticker {
  id              String   @id @default(cuid())
  symbol          String   @unique
  name            String?
  marketCap       Float?
  sector          String?
  industry        String?
  currency        String?
  sharesOutstanding Float?
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  snapshots       MetricsSnapshot[]
  watchlistItems  WatchlistItem[]
  newsArticles    NewsArticle[]
}

model MetricsSnapshot {
  id                 String   @id @default(cuid())
  tickerId            String
  date               DateTime @default(now())

  upsideScore        Float?
  strongMatch        Boolean  @default(false)

  # Upside mechanics (core)
  shortInterestPctFloat Float?
  daysToCover        Float?
  shortInterestTrend3m Float?

  valuationMultiple  Float?  // sector-specific: EV/FCF or P/E etc.
  valuationPctile    Float?
  reratingScore      Float?

  profitabilityTrend Float?  // op margin YoY or ROE/ROA trend (sector model)
  marginInflectionScore Float?

  deleveragingTrend  Float?  // leverage change proxy
  deriskingScore     Float?

  ownershipPct13F    Float?
  ownershipQoqChange Float?
  ownershipScore     Float?

  baseBreakoutTag    String? // "Building Base", "Breaking Out"
  floatShrinkTag     String?

  # Explainability (stored as JSON strings for simplicity)
  metCriteriaJson    String?
  redFlagsJson       String?
  sectorModelUsed    String?

  createdAt          DateTime @default(now())

  ticker             Ticker   @relation(fields: [tickerId], references: [id])
  @@index([tickerId, date])
}

model WatchlistItem {
  id        String   @id @default(cuid())
  tickerId  String
  addedAt   DateTime @default(now())
  status    String   @default("On Watch") // On Watch | Triggered | Dropped
  notes     String?

  ticker    Ticker   @relation(fields: [tickerId], references: [id])
  @@index([tickerId])
}

model NewsArticle {
  id             String   @id @default(cuid())
  tickerId       String
  publishedAt    DateTime
  title          String
  source         String?
  url            String?  @unique
  sentimentScore Float?
  sentimentLabel String?  // Positive | Neutral | Negative
  createdAt      DateTime @default(now())

  ticker         Ticker   @relation(fields: [tickerId], references: [id])
  @@index([tickerId, publishedAt])
}

model JobRun {
  id        String   @id @default(cuid())
  jobName   String
  startedAt DateTime @default(now())
  finishedAt DateTime?
  status    String   @default("running") // running | success | error
  statsJson String?
  errorJson String?
}
EOF

echo "==> Writing Prisma client helper"
mkdir -p src/lib
cat > src/lib/prisma.ts << 'EOF'
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const prisma =
  global.prisma ||
  new PrismaClient({
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") global.prisma = prisma;
EOF

echo "==> Writing types and utils"
mkdir -p src/lib/types
cat > src/lib/types/scoring.ts << 'EOF'
export type CriteriaHit = {
  label: string;
  value: string;
};

export type ScoreResult = {
  upsideScore: number;
  strongMatch: boolean;
  sectorModelUsed: string;
  metCriteria: CriteriaHit[];
  redFlags: string[];
  tags: string[];
};
EOF

cat > src/lib/utils.ts << 'EOF'
export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function pct(n: number | null | undefined, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "n/a";
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmt(n: number | null | undefined, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "n/a";
  return n.toFixed(digits);
}
EOF

echo "==> Writing Polygon client (minimal)"
mkdir -p src/services
cat > src/services/polygonClient.ts << 'EOF'
type Json = Record<string, any>;

const POLYGON = "https://api.polygon.io";

function key() {
  const k = process.env.POLYGON_API_KEY;
  if (!k) throw new Error("Missing POLYGON_API_KEY in env");
  return k;
}

async function getJson(path: string, params: Record<string, string | number | boolean | undefined> = {}) {
  const u = new URL(POLYGON + path);
  u.searchParams.set("apiKey", key());
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    u.searchParams.set(k, String(v));
  }
  const res = await fetch(u.toString(), { next: { revalidate: 60 } });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Polygon error ${res.status}: ${txt}`);
  }
  return (await res.json()) as Json;
}

/**
 * NOTE:
 * Polygon endpoints vary by plan.
 * This client is intentionally minimal and uses common endpoints.
 * Expand as needed (fundamentals, short interest, news).
 */

export async function listTickers(params: {
  market?: string;
  active?: boolean;
  limit?: number;
  cursor?: string;
}) {
  return getJson("/v3/reference/tickers", {
    market: params.market ?? "stocks",
    active: params.active ?? true,
    limit: params.limit ?? 1000,
    cursor: params.cursor,
  });
}

export async function tickerOverview(symbol: string) {
  return getJson(`/v3/reference/tickers/${encodeURIComponent(symbol)}`);
}

export async function dailyAgg(symbol: string, date: string) {
  // date: YYYY-MM-DD
  return getJson(`/v1/open-close/${encodeURIComponent(symbol)}/${date}`, {});
}

export async function aggsRange(symbol: string, from: string, to: string) {
  // 1 day candles
  return getJson(`/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${from}/${to}`, { adjusted: true, sort: "asc", limit: 50000 });
}

export async function news(symbol: string, limit = 50) {
  // If your plan supports it; otherwise you’ll get an error.
  return getJson(`/v2/reference/news`, { ticker: symbol, limit });
}

// OPTIONAL: short interest endpoint may differ by plan.
// Implement once you confirm availability on your account.
export async function shortInterest(symbol: string) {
  // Placeholder: replace with real endpoint your plan supports.
  // throw new Error("Short interest endpoint not configured for this plan.");
  return null;
}
EOF

echo "==> Writing EDGAR 13F service (placeholder + notes)"
cat > src/services/edgar13f.ts << 'EOF'
/**
 * EDGAR 13F ingestion is a larger module.
 * For v1 scaffold, we implement a placeholder interface and store nulls,
 * then you can expand to full parsing later.
 *
 * Plan:
 * - Pull recent 13F filings for managers (CIKs) from SEC endpoints
 * - Prefer XML "information table"
 * - Map CUSIP -> ticker (requires a mapping source; can be built from Polygon reference + CUSIP mapping where possible)
 */

export type Ownership13F = {
  ownershipPct: number | null;      // sum 13F shares / shares outstanding
  qoqChangePct: number | null;      // QoQ delta in 13F shares held
  concentrationTop10Pct: number | null;
};

export async function getOwnership13F(_symbol: string): Promise<Ownership13F> {
  return {
    ownershipPct: null,
    qoqChangePct: null,
    concentrationTop10Pct: null,
  };
}
EOF

echo "==> Writing sentiment engine (VADER)"
cat > src/services/sentiment.ts << 'EOF'
import vader from "vader-sentiment";

export type SentimentLabel = "Positive" | "Neutral" | "Negative";

export function scoreSentiment(text: string): { score: number; label: SentimentLabel } {
  const intensity = vader.SentimentIntensityAnalyzer.polarity_scores(text);
  const score = intensity.compound; // -1 to 1
  let label: SentimentLabel = "Neutral";
  if (score >= 0.2) label = "Positive";
  else if (score <= -0.2) label = "Negative";
  return { score, label };
}
EOF

echo "==> Writing upside scoring engine (core mechanics)"
cat > src/services/scoringEngine.ts << 'EOF'
import { clamp } from "@/lib/utils";
import type { ScoreResult } from "@/lib/types/scoring";

/**
 * Upside-first scoring. Fundamentals are only used as proxies for:
 * - margin/profitability inflection
 * - deleveraging / de-risking
 *
 * News sentiment is informational only (handled elsewhere).
 */

type Inputs = {
  symbol: string;
  sector: string | null;

  marketCap: number | null;

  // Liquidity / price action
  avgDollarVol20d: number | null;

  // Short interest (if available)
  shortInterestPctFloat: number | null;
  daysToCover: number | null;
  shortInterestTrend3m: number | null;

  // Valuation proxy (sector-aware)
  valuationMultiple: number | null; // e.g. EV/FCF or P/E
  valuationPctile: number | null;   // 0..1 lower is cheaper, or implement as percentile later

  // Profitability / margin inflection proxy
  profitabilityTrend: number | null; // e.g. op margin YoY change (bps/10000) or ROE delta

  // De-risking proxy
  deleveragingTrend: number | null;  // e.g. net debt/EBITDA change (negative is good)

  // Ownership 13F (later)
  ownershipPct13F: number | null;
  ownershipQoqChange: number | null;

  // Technical overlays
  baseBreakoutTag: string | null; // "Building Base" | "Breaking Out" | null
  floatShrinkTag: string | null;  // "Float Shrinking" | null
};

function scoreShortInterest(siPct: number | null, dtc: number | null, trend: number | null) {
  // Normalize roughly; replace with sector percentile once you compute distributions.
  let s = 0;
  if (siPct !== null) {
    // 0% -> 0, 20%+ -> 100 (cap)
    s += clamp((siPct / 0.20) * 100, 0, 100) * 0.6;
  }
  if (dtc !== null) {
    // 0 -> 0, 6+ -> 100
    s += clamp((dtc / 6) * 100, 0, 100) * 0.3;
  }
  if (trend !== null) {
    // Positive trend adds up to 10 points
    s += clamp(trend * 100, 0, 10) * 1.0;
  }
  return clamp(s, 0, 100);
}

function scoreValuation(mult: number | null, pctile: number | null) {
  // If pctile is provided (0..1 where 0=cheapest), use it.
  if (pctile !== null) {
    return clamp((1 - pctile) * 100, 0, 100);
  }
  // Fallback: very rough mapping.
  if (mult === null) return 0;
  // Lower multiple => higher score (cap)
  return clamp(100 - (mult * 5), 0, 100);
}

function scoreProfitabilityInflection(trend: number | null) {
  // trend is a proxy; positive is good. Map -0.10..+0.10 to 0..100
  if (trend === null) return 0;
  return clamp(((trend + 0.10) / 0.20) * 100, 0, 100);
}

function scoreDerisking(trend: number | null) {
  // deleveragingTrend: negative is good (debt ratio falling)
  if (trend === null) return 0;
  // Map +2 (worse) -> 0, -2 (better) -> 100
  return clamp(((2 - trend) / 4) * 100, 0, 100);
}

function scoreOwnership(ownPct: number | null, qoq: number | null) {
  // OwnPct: lower can be "vacuum" (good), rising QoQ can be accumulation (good).
  // For v1, treat missing as 0; once EDGAR is built, do sector-relative.
  let s = 0;
  if (ownPct !== null) {
    // Favor mid-low ownership: peak score around 30%
    const peak = 0.30;
    const dist = Math.abs(ownPct - peak);
    s += clamp(100 - dist * 250, 0, 100) * 0.6;
  }
  if (qoq !== null) {
    // +10% QoQ -> big boost
    s += clamp((qoq / 0.10) * 100, 0, 100) * 0.4;
  }
  return clamp(s, 0, 100);
}

export function scoreTicker(input: Inputs, threshold = 75): ScoreResult {
  const metCriteria: { label: string; value: string }[] = [];
  const redFlags: string[] = [];
  const tags: string[] = [];

  // Sector model selection (simplified placeholder)
  const sector = (input.sector ?? "Unknown").toLowerCase();
  const isFinancial = sector.includes("financial");
  const isReit = sector.includes("reit") || sector.includes("real estate");

  const sectorModelUsed = isFinancial ? "Financials" : isReit ? "REIT" : "Standard";

  // Component scores
  const sShort = scoreShortInterest(input.shortInterestPctFloat, input.daysToCover, input.shortInterestTrend3m);
  const sVal = scoreValuation(input.valuationMultiple, input.valuationPctile);
  const sProf = scoreProfitabilityInflection(input.profitabilityTrend);
  const sDerisk = scoreDerisking(input.deleveragingTrend);
  const sOwn = scoreOwnership(input.ownershipPct13F, input.ownershipQoqChange);

  let score =
    sShort * 0.25 +
    sVal * 0.20 +
    sProf * 0.20 +
    sDerisk * 0.15 +
    sOwn * 0.20;

  // Optional overlays
  if (input.baseBreakoutTag) {
    tags.push(input.baseBreakoutTag);
    score += input.baseBreakoutTag === "Breaking Out" ? 6 : 3;
  }
  if (input.floatShrinkTag) {
    tags.push(input.floatShrinkTag);
    score += 2;
  }
  score = clamp(score, 0, 100);

  // Explainability criteria hits (simple thresholds; refine later)
  if ((input.shortInterestPctFloat ?? 0) >= 0.08) metCriteria.push({ label: "Short Interest", value: `${(input.shortInterestPctFloat! * 100).toFixed(1)}% float` });
  if ((input.daysToCover ?? 0) >= 3) metCriteria.push({ label: "Days-to-cover", value: `${(input.daysToCover!).toFixed(2)}` });
  if ((input.valuationMultiple ?? 999) <= (isFinancial ? 12 : 12)) metCriteria.push({ label: "Valuation Discount", value: `Multiple=${(input.valuationMultiple ?? NaN).toFixed(2)}` });
  if ((input.profitabilityTrend ?? 0) > 0) metCriteria.push({ label: "Profitability Inflection", value: `Trend=${(input.profitabilityTrend!).toFixed(3)}` });
  if ((input.deleveragingTrend ?? 0) < 0) metCriteria.push({ label: "De-risking", value: `Trend=${(input.deleveragingTrend!).toFixed(3)}` });
  if ((input.ownershipQoqChange ?? 0) > 0.02) metCriteria.push({ label: "13F Accumulation", value: `QoQ=${(input.ownershipQoqChange! * 100).toFixed(1)}%` });

  // Red flags (do not exclude unless you decide later)
  if (input.avgDollarVol20d !== null && input.avgDollarVol20d < 5_000_000) redFlags.push("Low liquidity vs default $5M/day");
  if (input.marketCap !== null && input.marketCap < 500_000_000) redFlags.push("Market cap below $500M gate (should be filtered out earlier)");
  if (input.shortInterestPctFloat === null) redFlags.push("Short interest unavailable (score may understate forced-buying fuel)");
  if (input.ownershipPct13F === null) redFlags.push("13F ownership unavailable (EDGAR module not yet implemented)");

  const strongMatch = score >= threshold;

  return {
    upsideScore: score,
    strongMatch,
    sectorModelUsed,
    metCriteria,
    redFlags,
    tags,
  };
}
EOF

echo "==> Writing scan service (pulls a small universe for v1 demo)"
cat > src/services/scanService.ts << 'EOF'
import { prisma } from "@/lib/prisma";
import { scoreTicker } from "@/services/scoringEngine";
import * as polygon from "@/services/polygonClient";
import { getOwnership13F } from "@/services/edgar13f";
import { subDays, formatISO } from "date-fns";

function iso(d: Date) {
  return formatISO(d, { representation: "date" });
}

async function ensureTicker(symbol: string, meta: any) {
  const existing = await prisma.ticker.findUnique({ where: { symbol } });
  if (existing) return existing;

  const marketCap = meta?.results?.market_cap ?? null;
  const sector = meta?.results?.sic_description ?? meta?.results?.sector ?? null;
  const name = meta?.results?.name ?? null;
  const sharesOutstanding = meta?.results?.share_class_shares_outstanding ?? null;

  return prisma.ticker.create({
    data: {
      symbol,
      name,
      marketCap,
      sector,
      sharesOutstanding,
      isActive: true,
    },
  });
}

/**
 * NOTE: This "scanUniverse" is intentionally conservative for a first runnable repo.
 * In production, you’ll implement:
 * - universe listing pagination
 * - caching
 * - staged scanning
 * - fundamentals/short interest endpoints (depending on your Polygon plan)
 */
export async function scanUniverse(opts: {
  minMarketCap: number;     // 500M
  minDollarVol20d: number;  // 5M
  scoreThreshold: number;   // 75
  maxTickers?: number;      // dev convenience
}) {
  const maxTickers = opts.maxTickers ?? 200; // dev default so you don't hammer APIs

  // 1) Grab tickers (first page only for v1 demo)
  const tickersResp = await polygon.listTickers({ market: "stocks", active: true, limit: 1000 });
  const rawTickers: any[] = tickersResp?.results ?? [];
  const symbols = rawTickers
    .map(t => t.ticker)
    .filter((s: string) => typeof s === "string")
    .slice(0, maxTickers);

  const today = new Date();
  const from = iso(subDays(today, 30));
  const to = iso(subDays(today, 1));

  const results: any[] = [];

  for (const symbol of symbols) {
    // 2) Overview / metadata
    let overview: any;
    try {
      overview = await polygon.tickerOverview(symbol);
    } catch {
      continue;
    }

    const marketCap = overview?.results?.market_cap ?? null;
    if (marketCap !== null && marketCap < opts.minMarketCap) continue;

    // 3) Price/volume for liquidity proxy
    let aggs: any;
    try {
      aggs = await polygon.aggsRange(symbol, from, to);
    } catch {
      continue;
    }
    const candles: any[] = aggs?.results ?? [];
    if (candles.length < 10) continue;

    const avgDollarVol20d =
      candles.slice(-20).reduce((acc, c) => acc + (c.v * c.vw), 0) / Math.max(1, Math.min(20, candles.length));

    if (avgDollarVol20d < opts.minDollarVol20d) continue;

    // 4) Short interest (placeholder - returns null in scaffold)
    const si = await polygon.shortInterest(symbol);
    const shortInterestPctFloat = (si as any)?.short_interest_pct_float ?? null;
    const daysToCover = (si as any)?.days_to_cover ?? null;
    const shortInterestTrend3m = (si as any)?.trend_3m ?? null;

    // 5) Ownership (placeholder for now)
    const ownership = await getOwnership13F(symbol);

    // 6) Valuation + profitability + deleveraging proxies
    // For v1 scaffold, set to null; you’ll wire Polygon fundamentals endpoints as your plan allows.
    const valuationMultiple: number | null = null;
    const valuationPctile: number | null = null;
    const profitabilityTrend: number | null = null;
    const deleveragingTrend: number | null = null;

    const sector = overview?.results?.sic_description ?? overview?.results?.sector ?? null;

    // 7) Technical overlay placeholder (optional)
    const baseBreakoutTag: string | null = null;
    const floatShrinkTag: string | null = null;

    const scored = scoreTicker(
      {
        symbol,
        sector,
        marketCap,
        avgDollarVol20d,

        shortInterestPctFloat,
        daysToCover,
        shortInterestTrend3m,

        valuationMultiple,
        valuationPctile,

        profitabilityTrend,
        deleveragingTrend,

        ownershipPct13F: ownership.ownershipPct,
        ownershipQoqChange: ownership.qoqChangePct,

        baseBreakoutTag,
        floatShrinkTag,
      },
      opts.scoreThreshold
    );

    const tickerRow = await ensureTicker(symbol, overview);

    const snapshot = await prisma.metricsSnapshot.create({
      data: {
        tickerId: tickerRow.id,
        upsideScore: scored.upsideScore,
        strongMatch: scored.strongMatch,

        shortInterestPctFloat,
        daysToCover,
        shortInterestTrend3m,

        valuationMultiple,
        valuationPctile,
        reratingScore: null,

        profitabilityTrend,
        marginInflectionScore: null,

        deleveragingTrend,
        deriskingScore: null,

        ownershipPct13F: ownership.ownershipPct,
        ownershipQoqChange: ownership.qoqChangePct,
        ownershipScore: null,

        baseBreakoutTag,
        floatShrinkTag,

        metCriteriaJson: JSON.stringify(scored.metCriteria),
        redFlagsJson: JSON.stringify(scored.redFlags),
        sectorModelUsed: scored.sectorModelUsed,
      },
    });

    if (scored.strongMatch) {
      results.push({
        symbol,
        name: tickerRow.name,
        sector: tickerRow.sector,
        marketCap: tickerRow.marketCap,
        avgDollarVol20d,
        score: scored.upsideScore,
        sectorModelUsed: scored.sectorModelUsed,
        metCriteria: scored.metCriteria,
        redFlags: scored.redFlags,
        tags: scored.tags,
        snapshotId: snapshot.id,
      });
    }
  }

  // sort best first
  results.sort((a, b) => b.score - a.score);

  return results;
}
EOF

echo "==> Writing API routes"
mkdir -p src/app/api/scan
cat > src/app/api/scan/route.ts << 'EOF'
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { scanUniverse } from "@/services/scanService";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const minMarketCap = Number(body.minMarketCap ?? 500_000_000);
  const minDollarVol20d = Number(body.minDollarVol20d ?? 5_000_000);
  const scoreThreshold = Number(body.scoreThreshold ?? 75);
  const maxTickers = body.maxTickers ? Number(body.maxTickers) : 200; // dev guard

  const run = await prisma.jobRun.create({ data: { jobName: "scan", status: "running" } });

  try {
    const matches = await scanUniverse({ minMarketCap, minDollarVol20d, scoreThreshold, maxTickers });
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { status: "success", finishedAt: new Date(), statsJson: JSON.stringify({ matches: matches.length }) },
    });
    return NextResponse.json({ ok: true, matches });
  } catch (e: any) {
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { status: "error", finishedAt: new Date(), errorJson: JSON.stringify({ message: e?.message ?? String(e) }) },
    });
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}

export async function GET() {
  // Latest strong matches from snapshots
  const latest = await prisma.metricsSnapshot.findMany({
    where: { strongMatch: true },
    orderBy: { date: "desc" },
    take: 200,
    include: { ticker: true },
  });

  return NextResponse.json({
    ok: true,
    results: latest.map(s => ({
      symbol: s.ticker.symbol,
      name: s.ticker.name,
      sector: s.ticker.sector,
      marketCap: s.ticker.marketCap,
      score: s.upsideScore,
      metCriteria: safeJson(s.metCriteriaJson),
      redFlags: safeJson(s.redFlagsJson),
      tags: [s.baseBreakoutTag, s.floatShrinkTag].filter(Boolean),
      snapshotDate: s.date,
    })),
  });
}

function safeJson(s: string | null) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}
EOF

mkdir -p src/app/api/watchlist
cat > src/app/api/watchlist/route.ts << 'EOF'
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const items = await prisma.watchlistItem.findMany({
    include: { ticker: true },
    orderBy: { addedAt: "desc" },
  });
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: Request) {
  const body = await req.json();
  const symbol = String(body.symbol || "").toUpperCase();
  if (!symbol) return NextResponse.json({ ok: false, error: "symbol required" }, { status: 400 });

  const ticker = await prisma.ticker.findUnique({ where: { symbol } });
  if (!ticker) return NextResponse.json({ ok: false, error: "ticker not found in DB yet. Run scan first." }, { status: 400 });

  const exists = await prisma.watchlistItem.findFirst({ where: { tickerId: ticker.id } });
  if (exists) return NextResponse.json({ ok: true, item: exists });

  const item = await prisma.watchlistItem.create({
    data: { tickerId: ticker.id, status: "On Watch", notes: body.notes ? String(body.notes) : null },
    include: { ticker: true },
  });

  return NextResponse.json({ ok: true, item });
}
EOF

mkdir -p src/app/api/watchlist/snapshot
cat > src/app/api/watchlist/snapshot/route.ts << 'EOF'
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { scanUniverse } from "@/services/scanService";

/**
 * Simple "refresh tracked tickers" endpoint.
 * For real deployments, run this via cron (e.g. GitHub Actions, server cron, or scheduler).
 */
export async function POST() {
  // lightweight: just re-run scan for a limited universe and update snapshots
  // In production, you'd refresh only tracked tickers.
  const matches = await scanUniverse({
    minMarketCap: 500_000_000,
    minDollarVol20d: 5_000_000,
    scoreThreshold: 75,
    maxTickers: 200,
  });
  return NextResponse.json({ ok: true, refreshed: true, matches: matches.length });
}
EOF

echo "==> Writing UI pages"
mkdir -p src/app/scan
cat > src/app/scan/page.tsx << 'EOF'
"use client";

import { useState } from "react";

type Match = {
  symbol: string;
  name?: string | null;
  sector?: string | null;
  marketCap?: number | null;
  avgDollarVol20d: number;
  score: number;
  sectorModelUsed: string;
  metCriteria: { label: string; value: string }[];
  redFlags: string[];
  tags: string[];
};

export default function ScanPage() {
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [minMarketCap, setMinMarketCap] = useState(500_000_000);
  const [minDollarVol20d, setMinDollarVol20d] = useState(5_000_000);
  const [scoreThreshold, setScoreThreshold] = useState(75);
  const [maxTickers, setMaxTickers] = useState(200); // dev guard

  async function runScan() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minMarketCap, minDollarVol20d, scoreThreshold, maxTickers }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Scan failed");
      setMatches(j.matches);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function addToTracking(symbol: string) {
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
    });
    const j = await res.json();
    if (!j.ok) alert(j.error || "Failed to add");
    else alert(`${symbol} added to tracking`);
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Scan</h1>

      <div className="rounded-lg border p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-sm">
            Min Market Cap
            <input className="mt-1 w-full rounded border p-2" type="number" value={minMarketCap}
              onChange={(e) => setMinMarketCap(Number(e.target.value))} />
          </label>
          <label className="text-sm">
            Min $ Volume (20D)
            <input className="mt-1 w-full rounded border p-2" type="number" value={minDollarVol20d}
              onChange={(e) => setMinDollarVol20d(Number(e.target.value))} />
          </label>
          <label className="text-sm">
            Score Threshold
            <input className="mt-1 w-full rounded border p-2" type="number" value={scoreThreshold}
              onChange={(e) => setScoreThreshold(Number(e.target.value))} />
          </label>
          <label className="text-sm">
            Max Tickers (dev guard)
            <input className="mt-1 w-full rounded border p-2" type="number" value={maxTickers}
              onChange={(e) => setMaxTickers(Number(e.target.value))} />
          </label>
        </div>

        <button
          className="rounded bg-black text-white px-4 py-2 disabled:opacity-50"
          onClick={runScan}
          disabled={loading}
        >
          {loading ? "Scanning..." : "Run Scan"}
        </button>

        <p className="text-xs text-gray-600">
          Note: this scaffold limits tickers to avoid API spam. You’ll expand staged scanning + caching next.
        </p>

        {err && <div className="text-sm text-red-600">{err}</div>}
      </div>

      <div className="space-y-3">
        <div className="text-sm text-gray-700">
          Matches: <span className="font-semibold">{matches.length}</span>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left">
                <th className="p-3">Ticker</th>
                <th className="p-3">Score</th>
                <th className="p-3">Sector Model</th>
                <th className="p-3">Why Selected</th>
                <th className="p-3">Red Flags</th>
                <th className="p-3">Tracking</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.symbol} className="border-t">
                  <td className="p-3 font-semibold">{m.symbol}</td>
                  <td className="p-3">{m.score.toFixed(1)}</td>
                  <td className="p-3">{m.sectorModelUsed}</td>
                  <td className="p-3">
                    <ul className="list-disc pl-5">
                      {m.metCriteria?.slice(0, 6).map((c, i) => (
                        <li key={i}>
                          <span className="font-medium">{c.label}:</span> {c.value}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="p-3">
                    <ul className="list-disc pl-5 text-gray-700">
                      {(m.redFlags || []).slice(0, 4).map((rf, i) => <li key={i}>{rf}</li>)}
                    </ul>
                  </td>
                  <td className="p-3">
                    <button
                      className="rounded border px-3 py-1 hover:bg-gray-50"
                      onClick={() => addToTracking(m.symbol)}
                    >
                      Add
                    </button>
                  </td>
                </tr>
              ))}
              {matches.length === 0 && (
                <tr><td className="p-4 text-gray-600" colSpan={6}>No matches yet. Run scan.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
EOF

mkdir -p src/app/tracking
cat > src/app/tracking/page.tsx << 'EOF'
"use client";

import { useEffect, useState } from "react";

type Item = {
  id: string;
  status: string;
  notes?: string | null;
  ticker: { symbol: string; name?: string | null; sector?: string | null; marketCap?: number | null };
};

export default function TrackingPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    const res = await fetch("/api/watchlist");
    const j = await res.json();
    if (!j.ok) setErr(j.error || "Failed to load");
    else setItems(j.items);
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Tracking</h1>

      {err && <div className="text-sm text-red-600">{err}</div>}

      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left">
              <th className="p-3">Ticker</th>
              <th className="p-3">Status</th>
              <th className="p-3">Notes</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t">
                <td className="p-3 font-semibold">{it.ticker.symbol}</td>
                <td className="p-3">{it.status}</td>
                <td className="p-3">{it.notes ?? ""}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td className="p-4 text-gray-600" colSpan={3}>No tracked tickers yet. Add from Scan.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
EOF

echo "==> Updating home page links"
cat > src/app/page.tsx << 'EOF'
export default function Home() {
  return (
    <main className="p-6 space-y-4">
      <h1 className="text-3xl font-semibold">Upside Swing Screener</h1>
      <p className="text-gray-700">
        Upside-first market scanner (Polygon + EDGAR 13F). News sentiment is informational only.
      </p>
      <div className="flex gap-3">
        <a className="rounded bg-black text-white px-4 py-2" href="/scan">Go to Scan</a>
        <a className="rounded border px-4 py-2" href="/tracking">Go to Tracking</a>
      </div>
      <p className="text-sm text-gray-600">
        This repo scaffold is intentionally conservative (limits tickers per scan). Expand staged scanning + caching next.
      </p>
    </main>
  );
}
EOF

echo "==> Creating README"
cat > README.md << 'EOF'
# Upside Swing Screener (Scaffold)

Next.js + Prisma + SQLite scaffold for an upside-first stock scanner using Polygon + EDGAR 13F.

## Setup
1) Copy env
```bash
cp .env.example .env
