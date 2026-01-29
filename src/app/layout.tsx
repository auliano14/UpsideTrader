import "./globals.css";

export const metadata = {
  title: process.env.NEXT_PUBLIC_APP_NAME ?? "Upside Swing Screener"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-black">
        <div className="border-b">
          <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
            <a href="/" className="font-semibold">
              {process.env.NEXT_PUBLIC_APP_NAME ?? "Upside Swing Screener"}
            </a>
            <nav className="flex gap-4 text-sm">
              <a className="hover:underline" href="/scan">Scan</a>
              <a className="hover:underline" href="/tracking">Tracking</a>
            </nav>
          </div>
        </div>

        <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
