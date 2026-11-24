import { expect, test } from "bun:test";
import { collectCostProposalBatches } from "../src/lib/costProposalBatches";
test("52-line proposal processes sequential batches without duplicate equipment or lost labour", async () => {
  const offsets: number[] = []; let active = 0; let peak = 0;
  const result = await collectCostProposalBatches(async offset => {
    offsets.push(offset); active++; peak = Math.max(peak, active); await Promise.resolve(); active--;
    return { labour: Array.from({ length: Math.min(6, 52-offset) }, (_, i) => offset+i), equipment: ['shared crane'], uncertainties: ['Confirm availability'], exclusions: [], nextOffset: offset+6 < 52 ? offset+6 : null };
  }, () => {});
  expect(offsets).toEqual([0,6,12,18,24,30,36,42,48]);
  expect(result.labour).toHaveLength(52); expect(new Set(result.labour).size).toBe(52); expect(peak).toBe(1);
  expect(result.equipment).toEqual(['shared crane']); expect(result.uncertainties).toEqual(['Confirm availability']);
});
test("a failed batch rejects instead of returning an incomplete bid proposal", async () => {
  await expect(collectCostProposalBatches(async offset => { if(offset) throw Error('546'); return {labour:[1],equipment:[],uncertainties:[],exclusions:[],nextOffset:6}; },()=>{})).rejects.toThrow('546');
});
test("P2 exclusions contradicting priced lines move to review items", async () => {
  const r = await collectCostProposalBatches(async offset => offset === 0
    ? { labour: [{ description: "Pipe 12 m" }], equipment: [], uncertainties: [], exclusions: ["No labour added for insulation or hydrotesting", "Excludes scaffolding"], nextOffset: 6 }
    : { labour: [{ description: "Hydrotest PROVISIONAL" }, { description: "Insulation 12 m PROVISIONAL" }], equipment: [], uncertainties: [], exclusions: [], nextOffset: null }, () => {});
  expect(r.exclusions).toEqual(["Excludes scaffolding"]);
  expect(r.uncertainties.length).toBe(1);
  expect(r.uncertainties[0]).toContain("Hydrotest");
});
