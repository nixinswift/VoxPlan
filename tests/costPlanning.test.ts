import { expect, test } from "bun:test";
import { labourEffort, pricePlan, rankQuotes, type PlannedLabour, type CostPlan } from "../src/lib/costPlanning";

const line: PlannedLabour = { id: "1", estimateId: "pipe", description: "Pipe installation", trade: "mechanical", quantity: 12.5, uom: "m", hoursPerUnit: 2, factor: 1.2, workers: 3, maxWorkers: 4, rate: 76, evidence: "M-101", assumption: "provisional", crewMix: "2 fitters, 1 helper", quotes: [] };
test("quantity times installation productivity and conditions determines labour, not crew size", () => {
  expect(labourEffort(line, 8, 2).hours).toBe(30);
  expect(labourEffort({ ...line, workers: 6 }, 8, 2).hours).toBe(30);
  expect(labourEffort(line, 8, 2).days).toBe(1.25);
});
test("deadline staffing exceeding released work-front capacity is flagged", () => {
  expect(labourEffort({ ...line, hoursPerUnit: 20 }, 8, 2).capacityExceeded).toBe(true);
  expect(labourEffort({ ...line, hoursPerUnit: 20 }, 8, 2).requiredWorkers).toBe(19);
});
test("competitive quotes compare full cost and exclude unverified, expired or unavailable offers", () => {
  const quote = { id: "a", supplier: "Supplier", reference: "Q-101", validUntil: "2026-11-01", rate: 60, extras: 1000, available: true, comparable: true };
  const quotes = [quote, { ...quote, id: "b", rate: 70, extras: 0 }, { ...quote, id: "c", rate: 1, comparable: false }, { ...quote, id: "d", rate: 1, available: false }, { ...quote, id: "e", rate: 1, validUntil: "2026-10-01" }];
  expect(rankQuotes(quotes, 30, "2026-10-24").map(q => q.id)).toEqual(["b", "a"]);
  expect(rankQuotes(quotes, 30, "2026-10-24")[0].total).toBe(2100);
});
test("equipment includes rental units, duration, billing basis and fixed extras in CAD", () => {
  const plan: CostPlan = { labour: [line], equipment: [{ id: "lift", name: "Lift", days: 2, units: 1, rate: 300, basis: "day", extras: 150, requirement: "Reach TBD", quotes: [] }], context: "", targetDays: 2, fingerprint: "", uncertainties: [], exclusions: [], useInBid: false };
  expect(pricePlan(plan, 8, "2026-10-24").equipmentTotal).toBe(750);
  expect(pricePlan(plan, 8, "2026-10-24").labourTotal).toBe(2280);
  expect(pricePlan({ ...plan, labour: [{ ...line, rate: 0 }] }, 8, "2026-10-24").complete).toBe(false);
});