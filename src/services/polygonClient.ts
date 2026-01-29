const BASE = "https://api.polygon.io";

function apiKey() {
  const k = process.env.POLYGON_API_KEY;
  if (!k) throw new Error("Missing POLYGON_API_KEY in .env");
  return k;
}

async function getJson(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {}
) {
  const url = new URL(BASE + path);
  url.searchParams.set("apiKey", apiKey());
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Polygon ${res.status}: ${text}`);
  }
  return res.json();
}

export async function listTickers(limit = 1000) {
  return getJson("/v3/reference/tickers", { market: "stocks", active: true, limit });
}

export async function tickerOverview(symbol: string) {
  return getJson(`/v3/reference/tickers/${encodeURIComponent(symbol)}`);
}

export async function aggsDailyRange(symbol: string, from: string, to: string) {
  return getJson(`/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${from}/${to}`, {
    adjusted: true,
    sort: "asc",
    limit: 50000
  });
}
