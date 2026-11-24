export const fuelStates = ["idle", "light", "moderate", "heavy", "warmUp"] as const;
export type FuelState = typeof fuelStates[number];

export interface FuelStateInput {
  hours: number | null;
  litresPerHour: number | null;
}

export interface FuelDuty {
  fuelType: "" | "diesel" | "non-diesel";
  model: string;
  engine: string;
  temperatureC: number | null;
  conditions: string;
  source: string;
  sourceDate: string;
  shiftHours: number | null;
  productiveHours: number | null;
  states: Record<FuelState, FuelStateInput>;
  billing: "" | "included" | "separate";
}

const nonnegative = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export function isFuelSourceDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const instant = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === date;
}

type FuelDutyResult =
  | { status: "UNVERIFIED"; reason: string }
  | { status: "EXCLUDED"; reason: string }
  | { status: "DOCUMENTED"; engineHours: number; productiveHours: number; litres: number };

const pending = (reason: string): FuelDutyResult => ({ status: "UNVERIFIED", reason });

/** One machine's operating day. State hours are mutually exclusive, with engine-off time outside them. */
export function calculateFuelDuty(duty: FuelDuty | undefined): FuelDutyResult {
  if (!duty?.fuelType) return pending("Confirm fuel type and enter documented duty inputs.");
  if (duty.fuelType === "non-diesel") {
    return duty.conditions.trim()
      ? { status: "EXCLUDED", reason: duty.conditions }
      : pending("Document why this assignment does not consume diesel.");
  }
  if (![duty.model, duty.engine, duty.conditions, duty.source].every(text => text.trim()) ||
      !isFuelSourceDate(duty.sourceDate) || duty.temperatureC === null || !Number.isFinite(duty.temperatureC)) {
    return pending("Enter make/model, engine, temperature, operating assumptions and a dated source.");
  }
  if (!nonnegative(duty.shiftHours) || duty.shiftHours <= 0 || duty.shiftHours > 24 ||
      !nonnegative(duty.productiveHours)) {
    return pending("Enter a shift length up to 24 hours and productive hours.");
  }
  let engineHours = 0;
  let workingHours = 0;
  let litres = 0;
  for (const state of fuelStates) {
    const entry = duty.states[state];
    if (!nonnegative(entry?.hours)) return pending("Enter hours for every state. Enter zero for unused states.");
    if (entry.hours === 0) continue;
    if (!nonnegative(entry.litresPerHour) || entry.litresPerHour === 0) {
      return pending("Document an L/h rate for every state with engine hours.");
    }
    engineHours += entry.hours;
    if (state !== "idle" && state !== "warmUp") workingHours += entry.hours;
    litres += entry.hours * entry.litresPerHour;
  }
  if (!Number.isFinite(litres) || engineHours <= 0 || engineHours > duty.shiftHours + 1e-9 ||
      duty.productiveHours > workingHours + 1e-9) {
    return pending("Check that engine hours fit the shift and productive hours fit the working states.");
  }
  return { status: "DOCUMENTED", engineHours, productiveHours: duty.productiveHours, litres };
}
