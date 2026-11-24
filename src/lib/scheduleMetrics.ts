import { addDays, format, parseISO, startOfDay } from "date-fns";
import type { Task } from "@/types/schedule";
import { parseEquipmentDemand } from "../../supabase/functions/_shared/resource-equipment";

/** Date-only values are civil dates, never UTC timestamps. */
export const scheduleDate = (value: string | Date) =>
  typeof value === "string" ? parseISO(value) : new Date(value);

export const fuelDateLabel = (value: string, pattern = "MMM d") => format(scheduleDate(value), pattern);

/** Current daily views use [start, start + duration), excluding holidays. */
export function peakConcurrentWorkers(tasks: Task[], isHoliday: (day: Date) => boolean = () => false) {
  const loads = new Map<string, number>();
  for (const task of tasks) {
    const start = startOfDay(scheduleDate(task.startDate));
    for (let i = 0; i < Math.max(0, task.duration); i++) {
      const date = addDays(start, i);
      if (isHoliday(date)) continue;
      const key = format(date, "yyyy-MM-dd");
      loads.set(key, (loads.get(key) ?? 0) + task.manpower);
    }
  }
  return Math.max(0, ...loads.values());
}
/** Equipment quantity multiplies booked calendar days. Existing rental billing remains calendar-based. */
export function equipmentUnitDays(tasks: { equipment: string | null; duration: number }[]) {
  const rows = new Map<string, { key: string; days: number; tasks: number }>();
  for (const task of tasks) {
    for (const { key, quantity } of parseEquipmentDemand(task.equipment)) {
      const row = rows.get(key) ?? { key, days: 0, tasks: 0 };
      row.days += quantity * task.duration;
      row.tasks += 1;
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}
