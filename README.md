# Upside Swing Screener (MVP)

A beginner-friendly Next.js app that:
- Scans a limited set of US tickers (dev guard)
- Scores “Strong Matches”
- Explains why each was selected
- Shows news sentiment (informational only)
- Lets you track tickers over time (snapshots stored in SQLite)

## Setup
```bash
npm i
cp .env.example .env
# put your POLYGON_API_KEY in .env
npx prisma migrate dev --name init
npm run dev
