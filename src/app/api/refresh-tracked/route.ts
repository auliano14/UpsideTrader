import { NextResponse } from "next/server";
import { refreshTracked } from "@/services/scan";

export async function POST() {
  try {
    const n = await refreshTracked(75);
    return NextResponse.json({ ok: true, refreshedTickers: n });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
