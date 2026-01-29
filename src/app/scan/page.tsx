"use client";

import { useState } from "react";
import type { MatchRow } from "@/lib/types";
import { fmtMoney } from "@/lib/utils";

export default function ScanPage() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<MatchRow[]>([]);

  const [scoreThreshold, setScoreThreshold] = useState(75);
  const [minDollarVol20d, setMinDollarVol20d] = useState(5_000_000);
  const [maxTickers, setMaxTickers] = useState(200); // dev guard

  async function runScan() {
    setLoading(true);
    setErr(null);
    setRows([]);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scoreThreshold, minDollarVol20d, maxTickers })
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "Scan failed");
      setRows(j.matches);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function addToTracking(symbol: string) {
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol })
    });
    const j = await res.json();
    if (!j.ok) alert(j.error ?? "Failed");
    else alert(`${symbol} added to tracking`);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Scan</h1>

      <div className="rounded-lg border p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-sm">
            Score Threshold
            <input className="mt-1 w-full rounded border p-2" type="number"
              value={scoreThreshold} onChange={(e) => setScoreThreshold(Number(e.target.value))} />
          </label>

          <label className="text-sm">
            Min $ Volume (20D)
            <input className="mt-1 w-full rounded border p-2" type="number"
              value={minDollarVol20d} onChange={(e) => setMinDollarVol20d(Number(e.target.value))} />
          </label>

          <label className="text-sm">
            Max Tickers (dev guard)
            <input className="mt-1 w-full rounded border p-2" type="number"
              value={maxTickers} onChange={(e) => setMaxTickers(Number(e.target.value))} />
          </label>
        </div>

        <button className="rounded bg-black text-white px-4 py-2 disabled:opacity-50"
          onClick={runScan} disabled={loading}>
          {loading ? "Scanning..." : "Run Scan"}
        </button>

        <p className="text-xs text-gray-600">
          Dev guard limits tickers per scan. Increase later after you add caching/staged scans.
        </p>

        {err && <div className="text-sm text-red-600">{err}</div>}
      </div>

      <div className="text-sm text-gray-700">
        Strong matches: <span className="font-semibold">{rows.length}</span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left">
              <th className="p-3">Ticker</th>
              <th className="p-3">Score</th>
              <th className="p-3">Market Cap</th>
              <th className="p-3">Why Selected</th>
              <th className="p-3">News (info only)</th>
              <th className="p-3">Track</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} className="border-t align-top">
                <td className="p-3 font-semibold">{r.symbol}</td>
                <td className="p-3">{r.upsideScore.toFixed(1)}</td>
                <td className="p-3">{fmtMoney(r.marketCap)}</td>
                <td className="p-3">
                  <ul className="list-disc pl-5">
                    {r.why.slice(0, 6).map((c, i) => (
                      <li key={i}><span className="font-medium">{c.label}:</span> {c.value}</li>
                    ))}
                  </ul>
                  {r.notes.length > 0 && (
                    <div className="mt-2 text-xs text-gray-600">
                      Notes: {r.notes.join(" | ")}
                    </div>
                  )}
                </td>
                <td className="p-3">
                  {r.news ? (
                    <div>
                      <div className="font-medium">{r.news.label}</div>
                      <div className="text-xs text-gray-600">{r.news.trend}</div>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500">No recent news / unavailable</div>
                  )}
                </td>
                <td className="p-3">
                  <button className="rounded border px-3 py-1 hover:bg-gray-50"
                    onClick={() => addToTracking(r.symbol)}>
                    Add
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td className="p-4 text-gray-600" colSpan={6}>Run a scan to see results.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
