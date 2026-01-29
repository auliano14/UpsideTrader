"use client";

import { useEffect, useState } from "react";
import { safeJsonParse } from "@/lib/utils";

type Item = {
  id: string;
  status: string;
  notes: string | null;
  ticker: { symbol: string; name: string | null; marketCap: number | null };
};

type Snap = {
  date: string;
  upsideScore: number;
  strongMatch: boolean;
  newsLabel: string | null;
  newsTrend: string | null;
  metCriteriaJson: string;
};

export default function TrackingPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, Snap[]>>({});
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    const res = await fetch("/api/watchlist");
    const j = await res.json();
    if (!j.ok) { setErr(j.error ?? "Failed"); return; }

    setItems(j.items);

    const map: Record<string, Snap[]> = {};
    for (const it of j.items as Item[]) {
      const sres = await fetch(`/api/watchlist?symbol=${it.ticker.symbol}`);
      const sj = await sres.json();
      map[it.ticker.symbol] = sj.snapshots ?? [];
    }
    setSnapshots(map);
  }

  async function refreshTracked() {
    const res = await fetch("/api/refresh-tracked", { method: "POST" });
    const j = await res.json();
    if (!j.ok) alert(j.error ?? "Failed to refresh");
    else {
      alert("Refreshed tracked tickers (new snapshots saved)");
      await load();
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tracking</h1>
        <button className="rounded bg-black text-white px-4 py-2" onClick={refreshTracked}>
          Refresh Tracked
        </button>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      <div className="rounded-lg border overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left">
              <th className="p-3">Ticker</th>
              <th className="p-3">Status</th>
              <th className="p-3">Latest Score</th>
              <th className="p-3">News</th>
              <th className="p-3">Why (latest)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const sym = it.ticker.symbol;
              const snaps = snapshots[sym] ?? [];
              const latest = snaps[0];
              const why = latest ? (safeJsonParse(latest.metCriteriaJson, []) as any[]) : [];

              return (
                <tr key={it.id} className="border-t align-top">
                  <td className="p-3 font-semibold">{sym}</td>
                  <td className="p-3">{it.status}</td>
                  <td className="p-3">{latest ? latest.upsideScore.toFixed(1) : "n/a"}</td>
                  <td className="p-3">
                    {latest?.newsLabel ? (
                      <div>
                        <div className="font-medium">{latest.newsLabel}</div>
                        <div className="text-xs text-gray-600">{latest.newsTrend}</div>
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500">n/a</div>
                    )}
                  </td>
                  <td className="p-3">
                    {why.length ? (
                      <ul className="list-disc pl-5">
                        {why.slice(0, 4).map((c, i) => (
                          <li key={i}><span className="font-medium">{c.label}:</span> {c.value}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-gray-500">n/a</span>
                    )}
                  </td>
                </tr>
              );
            })}

            {items.length === 0 && (
              <tr><td className="p-4 text-gray-600" colSpan={5}>No tracked tickers yet. Add from /scan.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
