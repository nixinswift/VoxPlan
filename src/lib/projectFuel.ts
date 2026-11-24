import { addDays, format } from "date-fns";
import { z } from "zod";
import { calculateFuelDuty, fuelStates, isFuelSourceDate, type FuelDuty } from "../../supabase/functions/_shared/fuel-duty";
import { parseEquipmentDemand } from "../../supabase/functions/_shared/resource-equipment";
import { scheduleDate } from "./scheduleMetrics";
import { costExportNumber } from "./costExportNumbers";

const text = z.string().max(2000);
const numeric = z.number().finite().nullable();
const state = z.object({ hours: numeric, litresPerHour: numeric });

const fuelDutySchema = z.object({
  fuelType: z.enum(["", "diesel", "non-diesel"]),
  model: text,
  engine: text,
  temperatureC: numeric,
  conditions: text,
  source: text,
  sourceDate: text,
  shiftHours: numeric,
  productiveHours: numeric,
  states: z.object({ idle: state, light: state, moderate: state, heavy: state, warmUp: state }),
  billing: z.enum(["", "included", "separate"]),
});

export const fuelPlanSchema = z.object({
  workSaturday: z.boolean(),
  workSunday: z.boolean(),
  price: numeric,
  priceSource: text,
  priceDate: text,
  duties: z.record(fuelDutySchema),
});

export interface ProjectFuelPlan {
  workSaturday: boolean;
  workSunday: boolean;
  price: number | null;
  priceSource: string;
  priceDate: string;
  duties: Record<string, FuelDuty>;
}
export const emptyFuelPlan: ProjectFuelPlan = {
  workSaturday: false, workSunday: false, price: null, priceSource: "", priceDate: "", duties: {},
};

export const emptyFuelDuty: FuelDuty = {
  fuelType: "", model: "", engine: "", temperatureC: null, conditions: "", source: "", sourceDate: "",
  shiftHours: null, productiveHours: null, billing: "",
  states: {
    idle: { hours: null, litresPerHour: null }, light: { hours: null, litresPerHour: null },
    moderate: { hours: null, litresPerHour: null }, heavy: { hours: null, litresPerHour: null },
    warmUp: { hours: null, litresPerHour: null },
  },
};

export const stateLabels = {
  idle: "Idle", light: "Light duty", moderate: "Moderate duty", heavy: "Heavy duty", warmUp: "Warm-up",
};

export interface FuelTask {
  id: string;
  name: string;
  equipment: string | null;
  startDate: Date | string;
  duration: number;
}

export function projectFuelSummary(tasks: FuelTask[], plan: ProjectFuelPlan, holidayDates: string[]) {
  const holidays = new Set(holidayDates);
  const rows = tasks.flatMap(task => {
    const demand = parseEquipmentDemand(task.equipment);
    if (!demand.length) return [];
    const start = scheduleDate(task.startDate);
    let operatingDays = 0;
    for (let i = 0; i < task.duration; i += 1) {
      const date = addDays(start, i);
      if ((!plan.workSunday && date.getDay() === 0) || (!plan.workSaturday && date.getDay() === 6)) continue;
      const day = format(date, "yyyy-MM-dd");
      if (!holidays.has(day)) operatingDays += 1;
    }
    return demand.map(({ key, quantity }) => {
      const id = JSON.stringify([task.id, key]);
      const duty = plan.duties[id];
      const result = calculateFuelDuty(duty);
      const multiplier = operatingDays * quantity;
      const active = result.status === "DOCUMENTED" && operatingDays > 0;
      const reason = result.status === "DOCUMENTED"
        ? (operatingDays ? "" : "No operating days in the saved activity span and selected fuel calendar.")
        : result.reason;
      return {
        id, activity: task.name, equipment: key, quantity, operatingDays, duty,
        status: active ? "DOCUMENTED" as const : result.status === "EXCLUDED" ? "EXCLUDED" as const : "UNVERIFIED" as const,
        reason,
        shiftHours: active ? duty.shiftHours! * multiplier : null,
        engineHours: active ? result.engineHours * multiplier : null,
        productiveHours: active ? result.productiveHours * multiplier : null,
        litres: active ? result.litres * multiplier : null,
      };
    });
  });

  const unverified = rows.filter(row => row.status === "UNVERIFIED").length;
  const documented = rows.filter(row => row.status === "DOCUMENTED");
  const totalLitres = rows.length > 0 && unverified === 0 ? documented.reduce((sum, row) => sum + row.litres!, 0) : null;
  const price = plan.price !== null && Number.isFinite(plan.price) && plan.price > 0 &&
    plan.priceSource.trim() && isFuelSourceDate(plan.priceDate) ? plan.price : null;
  const totalCost = totalLitres === null || price === null ? null : totalLitres * price;
  const separate = documented.filter(row => row.duty.billing === "separate");
  const billingByEquipment = new Map<string, FuelDuty["billing"]>();
  const commercialComplete = unverified === 0 && documented.every(row => {
    const previousBilling = billingByEquipment.get(row.equipment);
    billingByEquipment.set(row.equipment, row.duty.billing);
    return row.duty.billing && (!previousBilling || previousBilling === row.duty.billing);
  });
  const separateCost = commercialComplete && separate.length > 0 && price !== null
    ? separate.reduce((sum, row) => sum + row.litres!, 0) * price : null;
  return { rows, unverified, totalLitres, price, totalCost, separateCost, commercialComplete,
    priceSource: plan.priceSource, priceDate: plan.priceDate, workSaturday: plan.workSaturday, workSunday: plan.workSunday };
}

export type ProjectFuelSummary = ReturnType<typeof projectFuelSummary>;

export function fuelExportRows(summary: ProjectFuelSummary) {
  return [
    ["DIESEL FUEL PLAN — SCHEDULED DEMAND"],
    ["Calendar", `Weekdays; Saturday ${summary.workSaturday ? "on" : "off"}; Sunday ${summary.workSunday ? "on" : "off"}; project holidays excluded`],
    ["Delivered CAD/L", summary.price ?? "UNVERIFIED", summary.priceSource, summary.priceDate],
    ["Fleet litres", summary.totalLitres ?? "UNVERIFIED"],
    ["Modeled delivered fuel cost (CAD)", summary.totalCost === null ? "UNVERIFIED" : costExportNumber(summary.totalCost)],
    ["Assignments", "Equipment", "Units", "Operating days", "Shift h", "Engine h", "Productive h", "Litres", "Status", "Rate treatment",
      "Model", "Engine", "Ambient °C", "Operating conditions", "Rate source", "Rate date",
      ...fuelStates.flatMap(state => [`${stateLabels[state]} h/unit/day`, `${stateLabels[state]} L/h`]), "Review"],
    ...summary.rows.map(row => [
      row.activity, row.equipment, row.quantity, row.operatingDays, row.shiftHours, row.engineHours, row.productiveHours, row.litres, row.status,
      row.duty?.billing || "UNREVIEWED", row.duty?.model, row.duty?.engine, row.duty?.temperatureC,
      row.duty?.conditions, row.duty?.source, row.duty?.sourceDate,
      ...fuelStates.flatMap(state => [row.duty?.states[state].hours, row.duty?.states[state].litresPerHour]), row.reason,
    ]),
  ];
}
