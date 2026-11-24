import { expect, test } from "bun:test";
import { concurrentAt, findingScore } from "../supabase/functions/_shared/resource-equipment";
test("D03 resource capacity counts simultaneous demand, not pairwise overlaps", () => {
  const activities = [{ startDate: "2026-11-23", duration: 4 }, { startDate: "2026-11-23", duration: 1 }, { startDate: "2026-11-26", duration: 1 }];
  expect(concurrentAt(activities, Date.parse("2026-11-23"))).toBe(2);
  expect(concurrentAt(activities, Date.parse("2026-11-26"))).toBe(2);
  expect(concurrentAt(activities, Date.parse("2026-11-27"))).toBe(0);
});
test("D03 health score uses final validated findings rather than a provider score", () => {
  expect(findingScore([{ severity: "high" }])).toBe(88);
  expect(findingScore([])).toBe(100);
});