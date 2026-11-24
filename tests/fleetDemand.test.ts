import { expect, test } from "bun:test";
import { buildPlan } from "../src/lib/scheduleEngine";
import { equipmentUnitDays } from "../src/lib/scheduleMetrics";
import { concurrentAt, parseEquipmentDemand } from "../supabase/functions/_shared/resource-equipment";
import type { Task } from "../src/types/schedule";

const haul = (id: string, quantity: number): Task => ({
  id, name: `Haul ${id}`, trade: "civil", manpower: quantity, duration: 3,
  startDate: new Date(2027, 5, 14), equipment: `${quantity} articulated trucks`,
});

test("parse fleet quantities without turning model numbers or tonne ratings into quantities", () => {
  const demands = parseEquipmentDemand("8x Cat 745 trucks, 40 tonne haul truck, 320 excavator, D11, EX01, 1 EX01, Cat 745 trucks x8");
  expect(demands.map(({ key, quantity }) => [key, quantity])).toEqual([
    ["cat 745 trucks", 8], ["40 tonne haul truck", 1], ["320 excavator", 1],
    ["d11", 1], ["ex01", 1],
  ]);
  expect(parseEquipmentDemand("1x crane C1")).toEqual([{ key: "crane c1", quantity: 1, countedPool: false }]);
  expect(parseEquipmentDemand("N/A")).toEqual([]);
});

test("cost equipment multiplies calendar duration by real fleet demand", () => {
  expect(equipmentUnitDays([haul("A", 8), haul("B", 3)])).toEqual([{ key: "articulated trucks", days: 33, tasks: 2 }]);
});

test("optimizer rejects unconfirmed or impossible fleets and levels weighted overlapping demand", () => {
  expect(buildPlan([haul("A", 8)]).canApply).toBe(false);
  const options = (available: number) => ({ constraints: [{ type: "equipment" as const, name: "articulated trucks", available }] });
  expect(buildPlan([haul("A", 8)], options(7)).canApply).toBe(false);
  expect(buildPlan([haul("A", 8)], options(0)).canApply).toBe(false);
  const plan = buildPlan([haul("A", 8), haul("B", 3)], options(8));
  expect(plan.canApply).toBe(true);
  expect(plan.issues.some(issue => issue.issue.includes("11 unit(s)"))).toBe(true);
  expect(plan.score).toBeLessThan(100);
  expect(plan.tasks[1].start.getTime()).toBeGreaterThan(plan.tasks[0].finish.getTime());
  const parallel = buildPlan([haul("A", 8), haul("B", 3)], options(11));
  expect(parallel.score).toBe(100);
  expect(parallel.tasks[0].start.getTime()).toBe(parallel.tasks[1].start.getTime());
});

test("schedule review concurrency weights fleet units without double counting adjacent spans", () => {
  const activities = [{ startDate: "2027-06-14", duration: 3, quantity: 8 }, { startDate: "2027-06-17", duration: 2, quantity: 3 }];
  expect(concurrentAt(activities, Date.parse("2027-06-16"))).toBe(8);
  expect(concurrentAt(activities, Date.parse("2027-06-17"))).toBe(3);
});
