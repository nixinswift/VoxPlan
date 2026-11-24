import { test, expect } from "bun:test";
import { scheduleEnd, scheduleOverlaps } from "../supabase/functions/_shared/schedule-intervals";

test("D08 Sunday one-day hydrotest does not overlap Monday lifts", () => {
  const hydro = { startDate: "2026-11-22", duration: 1 };
  const lift = { startDate: "2026-11-23", duration: 2 };
  expect(scheduleEnd(hydro).toISOString()).toBe("2026-11-23T00:00:00.000Z");
  expect(scheduleOverlaps(hydro, lift)).toBe(false);
  expect(scheduleOverlaps(lift, { ...lift })).toBe(true);
});