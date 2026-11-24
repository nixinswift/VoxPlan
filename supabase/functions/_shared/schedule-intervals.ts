export interface ScheduleInterval { startDate: string; duration: number }

/** Existing daily schedules use calendar durations and an exclusive finish. */
export function scheduleEnd(a: ScheduleInterval) {
  const date = new Date(`${a.startDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.max(1, Math.round(a.duration)));
  return date;
}

export function scheduleOverlaps(a: ScheduleInterval, b: ScheduleInterval) {
  const startA = new Date(`${a.startDate}T00:00:00Z`).getTime();
  const startB = new Date(`${b.startDate}T00:00:00Z`).getTime();
  return startA < scheduleEnd(b).getTime() && startB < scheduleEnd(a).getTime();
}