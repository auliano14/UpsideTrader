import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol")?.toUpperCase();

  if (!symbol) {
    const items = await prisma.watchlistItem.findMany({
      include: { ticker: true },
      orderBy: { addedAt: "desc" }
    });
    return NextResponse.json({ ok: true, items });
  }

  const ticker = await prisma.ticker.findUnique({ where: { symbol } });
  if (!ticker) return NextResponse.json({ ok: false, error: "Ticker not found" }, { status: 404 });

  const snaps = await prisma.metricsSnapshot.findMany({
    where: { tickerId: ticker.id },
    orderBy: { date: "desc" },
    take: 30
  });

  return NextResponse.json({
    ok: true,
    snapshots: snaps.map(s => ({
      date: s.date,
      upsideScore: s.upsideScore,
      strongMatch: s.strongMatch,
      newsLabel: s.newsLabel,
      newsTrend: s.newsTrend,
      metCriteriaJson: s.metCriteriaJson
    }))
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const symbol = String(body.symbol ?? "").toUpperCase();
  if (!symbol) return NextResponse.json({ ok: false, error: "symbol required" }, { status: 400 });

  const ticker = await prisma.ticker.findUnique({ where: { symbol } });
  if (!ticker) {
    return NextResponse.json({ ok: false, error: "Run a scan first so the ticker exists in DB." }, { status: 400 });
  }

  const existing = await prisma.watchlistItem.findFirst({ where: { tickerId: ticker.id } });
  if (existing) return NextResponse.json({ ok: true, item: existing });

  const item = await prisma.watchlistItem.create({
    data: { tickerId: ticker.id, status: "On Watch", notes: body.notes ? String(body.notes) : null },
    include: { ticker: true }
  });

  return NextResponse.json({ ok: true, item });
}
