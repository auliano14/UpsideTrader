// Placeholder for EDGAR 13F logic.
// You WILL be able to add this later without changing the rest of the app.
// For now, we keep the app working for beginners.

export type Ownership13F = {
  ownershipPct: number | null;
  qoqChangePct: number | null;
};

export async function getOwnership13F(_symbol: string): Promise<Ownership13F> {
  return { ownershipPct: null, qoqChangePct: null };
}
