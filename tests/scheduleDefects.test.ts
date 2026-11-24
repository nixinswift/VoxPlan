import { expect, test } from "bun:test";
import { buildPlan, getPhase, toISO, parseEquipment } from "../src/lib/scheduleEngine";
import { fuelDateLabel, peakConcurrentWorkers } from "../src/lib/scheduleMetrics";
import type { Task } from "../src/types/schedule";

const task = (id: string, name: string, date: string, trade: Task["trade"] = "mechanical", workers = 3): Task =>
  ({ id, name, startDate: new Date(`${date}T00:00:00`), trade, manpower: workers, equipment: "1 crane C1", duration: 2 });

test("D03 identical-named crane tasks remain two resource bookings", () => {
  const plan = buildPlan([task("a", "QA Crane Lift A", "2026-11-23"), task("b", "QA Crane Lift A", "2026-11-23")]);
  expect(plan.issues.some(i => i.type === "equipment" && i.issue.includes("2 activities"))).toBe(true);
  expect(plan.score).toBeLessThan(100);
  expect(plan.tasks[1].start.getTime()).toBeGreaterThan(plan.tasks[0].finish.getTime());
});

test("D04 maintenance preserves intent without structural dependencies", () => {
  const activities = [task("f", "Fire Suppression Test", "2025-11-27"), task("h", "HVAC System Inspection", "2025-11-10"), task("g", "Generator Load Test", "2025-11-15", "electrical")].map(t => ({ ...t, equipment: "", duration: 1 }));
  expect(getPhase(activities[0]).rank).toBe(0);
  const plan = buildPlan(activities);
  expect(plan.issues.filter(i => i.type === "sequence")).toHaveLength(0);
  expect(toISO(plan.tasks.find(t => t.id === "h")?.start ?? new Date(0))).toBe("2025-11-10");
  expect(plan.issues.find(i => i.type === "calendar")?.proposedStartDate).toBe("2025-11-17");
});

test("D06 nonoverlapping trade crews have simultaneous peak 4, not 15", () => {
  const tasks = [2, 2, 3, 2, 2, 4].map((n, i) => task(String(i), "maintenance", `2026-11-${String(10 + i * 3).padStart(2, "0")}`, i % 2 ? "general" : "mechanical", n));
  expect(peakConcurrentWorkers(tasks)).toBe(4);
  expect(peakConcurrentWorkers(tasks, d => d.getDate() === 25 || d.getDate() === 26)).toBe(3);
});

test("D07 civil fuel dates stay Nov 15 and Dec 9 in Edmonton and UTC", () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ["UTC", "America/Edmonton"]) {
      process.env.TZ = zone;
      expect(fuelDateLabel("2025-11-15")).toBe("Nov 15");
      expect(fuelDateLabel("2025-12-09")).toBe("Dec 9");
    }
  } finally { process.env.TZ = previous; }
});

test("D03 original Sunday/Monday occupancy agrees with daily workforce", () => {
  const activities = [task("sun", "Hydrotest", "2026-11-22"), task("mon", "Lift", "2026-11-23")].map(t => ({ ...t, duration: 1 }));
  const plan = buildPlan(activities);
  expect(plan.peakWorkers).toBe(3);
  expect(plan.peakWorkers).toBe(peakConcurrentWorkers(activities));
  expect(plan.issues.filter(i => i.type === "equipment")).toHaveLength(0);
  const applied = activities.map(t => ({ ...t, startDate: plan.tasks.find(p => p.id === t.id)?.start ?? t.startDate }));
  expect(peakConcurrentWorkers(applied)).toBe(plan.optimizedPeakWorkers);
});
test("D04 no inferred steel/fire-alarm dependencies; explicit predecessors enforce order", () => {
  const activities = [task("alarm", "Fire alarm test", "2026-11-23", "electrical"), task("steel", "Steel repair", "2026-11-30", "structural")].map(t => ({ ...t, equipment: "", duration: 1 }));
  expect(toISO(buildPlan(activities).tasks.find(t => t.id === "alarm")?.start ?? new Date(0))).toBe("2026-11-23");
  const linked = [{ ...activities[0], predecessorIds: ["steel"] }, activities[1]];
  const plan = buildPlan(linked);
  expect(plan.issues.some(i => i.type === "sequence" && i.taskId === "alarm")).toBe(true);
  expect(toISO(plan.tasks.find(t => t.id === "alarm")?.start ?? new Date(0))).toBe("2026-12-01");
  expect(buildPlan([{ ...activities[0], predecessorIds: ["steel"] }, { ...activities[1], predecessorIds: ["alarm"] }]).canApply).toBe(false);
});
test("D03 equipment token identity and impossible crew plans cannot mislead approval", () => {
  expect(parseEquipment("Crane + lift, crane; NULL")).toEqual(["crane", "lift"]);
  const plan = buildPlan([task("a", "Lift", "2026-11-23")], { constraints: [{ type: "workers", name: "mechanical", available: 2 }] });
  expect(plan.canApply).toBe(false);
  expect(plan.score).toBeLessThan(100);
});
test("D03 missing intermediate phases do not manufacture inherited dependencies", () => {
  const activities = [task("steel", "Steel erection", "2026-11-23", "structural"), task("paint", "Painting", "2026-11-23", "finishes")].map(t => ({ ...t, equipment: "", duration: 1 }));
  const plan = buildPlan(activities, { inferConstructionSequencing: true });
  expect(plan.issues.filter(i => i.type === "sequence")).toHaveLength(0);
  expect(toISO(plan.tasks.find(t => t.id === "paint")?.start ?? new Date(0))).toBe("2026-11-23");
});
test("P1 quantity prefixes do not split one crane into separate identities", () => {
  for (const raw of ["1 crane C1", "Crane C1", "(1) Crane C1", "1x crane c1", "one crane C1", "Crane  C1 x1"]) {
    expect(parseEquipment(raw)).toEqual(["crane c1"]);
  }
  expect(parseEquipment("Crane C1")).not.toEqual(parseEquipment("Crane C2"));
});

test("P1 three bookings of crane C1 with mixed naming all conflict and serialize", () => {
  const ts = [task("a", "Lift A", "2026-11-23"), task("b", "Lift B", "2026-11-23"), task("c", "Lift C", "2026-11-23")];
  ts[0].equipment = "1 crane C1"; ts[1].equipment = "Crane C1"; ts[2].equipment = "Crane C1";
  const plan = buildPlan(ts);
  expect(plan.issues.some(i => i.type === "equipment" && i.issue.includes("3 activities"))).toBe(true);
  const sorted = [...plan.tasks].sort((x, y) => x.start.getTime() - y.start.getTime());
  expect(sorted[1].start.getTime()).toBeGreaterThan(sorted[0].finish.getTime());
  expect(sorted[2].start.getTime()).toBeGreaterThan(sorted[1].finish.getTime());
});
