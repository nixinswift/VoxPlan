/** Accumulate sequential responses atomically; failed batches never replace a saved proposal. */
export async function collectCostProposalBatches<T extends { labour: unknown[]; equipment: unknown[]; uncertainties: string[]; exclusions: string[]; nextOffset: number | null }>(request: (offset: number) => Promise<T>, progress: (completed: number) => void) {
  const result = { labour: [] as T['labour'], equipment: [] as T['equipment'], uncertainties: [] as string[], exclusions: [] as string[] };
  let offset: number | null = 0;
  while (offset !== null) {
    const batch = await request(offset);
    result.labour.push(...batch.labour);
    if (offset === 0) result.equipment.push(...batch.equipment);
    result.uncertainties.push(...batch.uncertainties);
    result.exclusions.push(...batch.exclusions);
    if (batch.nextOffset !== null && batch.nextOffset <= offset) throw new Error("Cost planning did not advance. Your saved proposal is unchanged.");
    progress(batch.nextOffset ?? offset + batch.labour.length);
    offset = batch.nextOffset;
  }
  const { exclusions, conflicts } = reconcileExclusions([...new Set(result.exclusions)], result.labour as { description?: string }[]);
  return { ...result, uncertainties: [...new Set([...result.uncertainties, ...conflicts])], exclusions };
}

const STOP = new Set(["labour", "labor", "install", "installation", "supply", "allowance", "provisional", "included", "excluded", "required", "testing"]);
const stems = (text: string) => (text.toLowerCase().match(/[a-z]{5,}/g) ?? []).filter(w => !STOP.has(w)).map(w => w.replace(/(ing|es|s)$/, ""));

/** Each batch only sees its own lines, so an exclusion can deny scope another batch priced. Such exclusions become review items instead of contradicting the bid. */
export function reconcileExclusions(exclusions: string[], labour: { description?: string }[]) {
  const priced = labour.map(l => ({ description: l.description ?? "", words: new Set(stems(l.description ?? "")) }));
  const kept: string[] = [], conflicts: string[] = [];
  for (const exclusion of exclusions) {
    const hits = priced.filter(p => stems(exclusion).some(w => p.words.has(w)));
    if (hits.length) conflicts.push(`Review scope: exclusion "${exclusion}" conflicts with priced line(s) ${hits.map(h => `"${h.description}"`).join(", ")} and was removed from exclusions.`);
    else kept.push(exclusion);
  }
  return { exclusions: kept, conflicts };
}