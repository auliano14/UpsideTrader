export default function Home() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold">Upside Swing Screener</h1>
      <p className="text-gray-700">
        Finds upside swing setups using trend, compression, breakout, and volume signals (Polygon Stocks Starter).
        News sentiment is informational only.
      </p>
      <div className="flex gap-3">
        <a className="rounded bg-black text-white px-4 py-2" href="/scan">Go to Scan</a>
        <a className="rounded border px-4 py-2" href="/tracking">Go to Tracking</a>
      </div>
    </div>
  );
}
