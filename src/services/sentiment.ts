import vader from "vader-sentiment";

export type SentimentLabel = "Positive" | "Neutral" | "Negative";

export function sentimentFromText(text: string): { score: number; label: SentimentLabel } {
  const r = vader.SentimentIntensityAnalyzer.polarity_scores(text);
  const score = r.compound; // -1..1
  let label: SentimentLabel = "Neutral";
  if (score >= 0.2) label = "Positive";
  if (score <= -0.2) label = "Negative";
  return { score, label };
}
