import { NextResponse } from "next/server";
import { runScan } from "@/services/scan";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const scoreThreshold = Number(body.scoreThreshold ?? 75);
  const minDollarVol20d = Number(body.minDollarVol20d ?? 5_000_000);
  const maxTickers = Number(body.maxTickers ?? 200);

  try {
    const matches = await runScan({ scoreThreshold, minDollarVol20d, maxTickers });
    return NextResponse.json({ ok: true, matches });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}

// GET is used by tracking page as a lightweight endpoint; not critical.
export async function GET() {
  return NextResponse.json({ ok: true });
}
