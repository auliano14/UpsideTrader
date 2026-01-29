import { prisma } from "@/lib/prisma";
import { sentimentFromText } from "@/services/sentiment";
import type { NewsSummary } from "@/lib/types";
import { subDays } from "date-fns";
import * as polygon from "@/services/polygonClient";

function avg(nums: number[]) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export async function ingestNewsForTicker(symbol: string): Promise<void> {
  const resp = await polygon.news(symbol, 50);
  const results: any[] = resp?.results ?? [];

  for (const a of results) {
    const url: string | undefined = a?.article_url;
    if (!url) continue;

    const exists = await prisma.newsArticle.findUnique({ where: { url } });
    if (exists) continue;

    const title = String(a?.title ?? "");
    const source = a?.publisher?.name ? String(a.publisher.name) : null;
    const publishedAt = a?.published_utc ? new Date(a.published_utc) : new Date();

    const { score, label } = sentimentFromText(title);

    // Ensure ticker exists in DB (news routes assume it)
    const ticker = await prisma.ticker.upsert({
      where: { symbol },
      update: {},
      create: { symbol }
    });

    await prisma.newsArticle.create({
      data: {
        tickerId: ticker.id,
        publishedAt,
        title,
        source,
        url,
        sentimentScore: score,
        sentimentLabel: label
      }
    });
  }
}

export async function getNewsSummary(symbol: string): Promise<NewsSummary | null> {
  const ticker = await prisma.ticker.findUnique({ where: { symbol } });
  if (!ticker) return null;

  const since7 = subDays(new Date(), 7);
  const since3 = subDays(new Date(), 3);

  const last7 = await prisma.newsArticle.findMany({
    where: { tickerId: ticker.id, publishedAt: { gte: since7 } },
    orderBy: { publishedAt: "desc" }
  });
  if (!last7.length) return null;

  const s7 = avg(last7.map(x => x.sentimentScore));
  const last3 = last7.filter(x => x.publishedAt >= since3);
  const s3 = last3.length ? avg(last3.map(x => x.sentimentScore)) : s7;

  let label: NewsSummary["label"] = "Neutral";
  if (s3 >= 0.2) label = "Positive";
  else if (s3 <= -0.2) label = "Negative";

  let trend: NewsSummary["trend"] = "Stable";
  const diff = s3 - s7;
  if (diff > 0.08) trend = "Improving";
  else if (diff < -0.08) trend = "Worsening";

  return { label, trend, score3d: s3, score7d: s7 };
}
