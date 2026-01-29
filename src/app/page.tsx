export default function Home() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold">Upside Swing Screener</h1>
      <p className="text-gray-700">
        Scan stocks, see why they were selected, view news sentiment (informational only), and track progress over time.
      </p>
      <div className="flex gap-3">
        <a className="rounded bg-black text-white px-4 py-2" href="/scan">Go to Scan</a>
        <a className="rounded border px-4 py-2" href="/tracking">Go to Tracking</a>
      </div>
      <p className="text-sm text-gray-600">
        This MVP uses Polygon tickers + price aggregates + news sentiment. You can add short interest, ownership (13F),
        and fundamentals later.
      </p>
    </div>
  );
}
