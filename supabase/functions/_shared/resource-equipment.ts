export interface EquipmentDemand {
  key: string;
  quantity: number;
  /** A counted pool needs a declared capacity. A named unit keeps the legacy single-unit assumption. */
  countedPool: boolean;
}

// Explicit counts (8x trucks or trucks x8) can precede model names. Unmarked
// numbers that start a mass/size description or a three-digit model stay in the name.
const countedPrefix = /^(?:\((\d+)\)\s*|([0-9]+)\s*[x×]\s*|([0-9]+)\s+(?:ea\.?|no\.?)\s+|([1-9]\d?)\s+(?![-\d]|(?:t|tons?|tonnes?|kg|lb|lbs|m|m3|m³|mm|kw|hp|ft|inch|in)\b)|(?:one|an?)\s+)(.+)$/i;
const countedSuffix = /\s+[x×]\s*(\d+)$/i;

function readDemand(raw: string): EquipmentDemand {
  const name = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const prefix = name.match(countedPrefix);
  const suffix = prefix ? null : name.match(countedSuffix);
  const key = (prefix?.[5] ?? (suffix ? name.slice(0, suffix.index) : name)).trim();
  const count = Number(prefix?.[1] ?? prefix?.[2] ?? prefix?.[3] ?? prefix?.[4] ?? suffix?.[1] ?? 1);
  const quantity = Number.isSafeInteger(count) && count > 0 ? count : 1;
  return { key, quantity, countedPool: quantity > 1 };
}

/** "1 crane C1", "(1) Crane C1", "1x crane c1", "one crane C1", "Crane C1 x1" share a rate key. */
export const normalizeEquipmentName = (raw: string) => readDemand(raw).key;

/** Duplicate spellings in one task denote one assignment. Keep the strongest explicit demand. */
export function parseEquipmentDemand(raw?: string | null): EquipmentDemand[] {
  const text = raw?.trim() ?? "";
  if (/^(none|null|n\/a|na|tbd|-)$/i.test(text)) return [];
  const demands = new Map<string, EquipmentDemand>();
  for (const item of text.split(/[,;\n/&]|\band\b|\+/i)) {
    const demand = readDemand(item);
    if (demand.key.length <= 1 || /^(none|null|n\/a|na|tbd)$/.test(demand.key)) continue;
    const current = demands.get(demand.key);
    if (!current || demand.quantity > current.quantity || (!current.countedPool && demand.countedPool)) {
      demands.set(demand.key, demand);
    }
  }
  return [...demands.values()];
}

export const parseEquipment = (raw?: string | null): string[] => parseEquipmentDemand(raw).map(({ key }) => key);
export const findingScore = (findings: { severity: string }[]) => Math.max(0, 100 - findings.reduce((sum, f) => sum + (f.severity === "high" ? 12 : f.severity === "medium" ? 6 : 2), 0));
export function concurrentAt(activities: { startDate: string; duration: number; quantity?: number }[], instant: number): number {
  return activities.reduce((total, a) => {
    const start = Date.parse(a.startDate);
    return start <= instant && instant < start + a.duration * 86400000 ? total + (a.quantity ?? 1) : total;
  }, 0);
}
