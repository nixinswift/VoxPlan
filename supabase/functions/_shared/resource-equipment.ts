/** "1 crane C1", "(1) Crane C1", "1x crane c1", "one crane C1", "Crane C1 x1" all name the same unit. */
export const normalizeEquipmentName = (raw: string) => raw.trim().toLowerCase()
  .replace(/^\(?\s*(?:\d+|one|a|an)\s*\)?\s*(?:x|×|ea\.?|no\.?)?\s+/, "")
  .replace(/\s+(?:x|×)\s*\d+$/, "")
  .replace(/\s+/g, " ").trim();

/** Shared equipment identity; repeated tokens in one activity are not extra bookings. */
export const parseEquipment = (raw?: string): string[] => [...new Set((raw ?? "")
  .split(/[,;/&]|\band\b|\+/i).map(normalizeEquipmentName)
  .filter(e => e.length > 1 && !/^(none|null|n\/a|na|tbd)$/.test(e)))];
export const findingScore = (findings: { severity: string }[]) => Math.max(0, 100 - findings.reduce((sum, f) => sum + (f.severity === "high" ? 12 : f.severity === "medium" ? 6 : 2), 0));
export function concurrentAt(activities: { startDate: string; duration: number }[], instant: number): number {
  return activities.filter(a => {
    const start = Date.parse(a.startDate);
    return start <= instant && instant < start + a.duration * 86400000;
  }).length;
}