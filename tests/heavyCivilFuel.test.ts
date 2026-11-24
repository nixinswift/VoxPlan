import { expect, test } from "bun:test";
import { calculateFuelDuty, type FuelDuty } from "../supabase/functions/_shared/fuel-duty";
import { emptyFuelDuty, emptyFuelPlan, fuelExportRows, projectFuelSummary } from "../src/lib/projectFuel";
import { commercialTotals } from "../src/lib/costPlanning";

const countedFleet: FuelDuty = {
  ...emptyFuelDuty,
  fuelType: "diesel", model: "Synthetic fleet for arithmetic", engine: "Fixture",
  temperatureC: -20, conditions: "Synthetic winter duty cycle. No OEM benchmark.",
  source: "QA arithmetic fixture", sourceDate: "2026-11-24",
  shiftHours: 12, productiveHours: 8, billing: "separate",
  states: {
    idle: { hours: 1, litresPerHour: 3 },
    light: { hours: 1, litresPerHour: 10 },
    moderate: { hours: 2, litresPerHour: 20 },
    heavy: { hours: 6, litresPerHour: 40 },
    warmUp: { hours: 0.5, litresPerHour: 8 },
  },
};
const task = {
  id: "haul", name: "Test haul", equipment: "8 articulated trucks", startDate: "2027-06-18", duration: 5,
};
const key = JSON.stringify([task.id, "articulated trucks"]);
const plan = { ...emptyFuelPlan, price: 1.6, priceSource: "Local fixture", priceDate: "2026-11-24",
  duties: { [key]: countedFleet } };

test("missing fuel type, source, state rate or a realistic engine-hour allocation produces no fuel figure", () => {
  expect(calculateFuelDuty(undefined).status).toBe("UNVERIFIED");
  expect(calculateFuelDuty({ ...countedFleet, source: "" }).status).toBe("UNVERIFIED");
  expect(calculateFuelDuty({ ...countedFleet, sourceDate: "2026-02-31" }).status).toBe("UNVERIFIED");
  expect(calculateFuelDuty({ ...countedFleet, states: { ...countedFleet.states, heavy: { hours: 6, litresPerHour: null } } }).status).toBe("UNVERIFIED");
  expect(calculateFuelDuty({ ...countedFleet, shiftHours: 8 }).status).toBe("UNVERIFIED");
  expect(calculateFuelDuty({ ...countedFleet, productiveHours: 10 }).status).toBe("UNVERIFIED");
});

test("weighted duty, machine counts and work calendar reproduce independent winter arithmetic", () => {
  expect(calculateFuelDuty(countedFleet)).toEqual({
    status: "DOCUMENTED", engineHours: 10.5, productiveHours: 8, litres: 297,
  });
  const result = projectFuelSummary([task], plan, ["2027-06-21"]);
  expect(result.rows[0]).toMatchObject({ operatingDays: 2, quantity: 8, shiftHours: 192,
    engineHours: 168, productiveHours: 128, litres: 4752 });
  expect(result.totalLitres).toBe(4752);
  expect(result.totalCost).toBeCloseTo(7603.2, 2);
  expect(result.separateCost).toBeCloseTo(7603.2, 2);
  expect(fuelExportRows(result)[3]).toEqual(["Fleet litres", 4752]);
});

test("temperature is an explicit duty assumption, and only explicit warm-up adds fuel", () => {
  for (const temperatureC of [20, 0, -10, -20, -30, -40]) {
    expect(calculateFuelDuty({ ...countedFleet, temperatureC })).toEqual(calculateFuelDuty(countedFleet));
  }
  const summer = { ...countedFleet, temperatureC: 20,
    states: { ...countedFleet.states, warmUp: { hours: 0, litresPerHour: null } } };
  expect(calculateFuelDuty(summer)).toMatchObject({ litres: 293, engineHours: 10 });
});

test("work and price changes update totals; included fuel and unresolved rows cannot be charged twice", () => {
  const saved = projectFuelSummary([task], plan, []);
  const changed = projectFuelSummary([{ ...task, duration: 4 }], { ...plan, price: 2 }, []);
  expect(saved.totalLitres).toBe(7128);
  expect(changed.totalCost).toBe(9504);
  const included = { ...plan, duties: { [key]: { ...countedFleet, billing: "included" as const } } };
  expect(projectFuelSummary([task], included, []).separateCost).toBeNull();
  const other = { ...task, id: "other" };
  expect(projectFuelSummary([task, other], plan, []).totalLitres).toBeNull();
  const mixed = projectFuelSummary([task, other], { ...plan,
    duties: { ...plan.duties, [JSON.stringify(["other", "articulated trucks"])]: { ...countedFleet, billing: "included" } },
  }, []);
  expect(mixed.commercialComplete).toBe(false);
  expect(mixed.separateCost).toBeNull();
  expect(commercialTotals({ labour: 100, equipment: 200, materials: 50, fuel: 50 }, 10, 10)).toEqual({
    directTotal: 400, overhead: 40, profit: 44, grandTotal: 484,
  });
});
