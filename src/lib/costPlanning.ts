export interface CostQuote {
  id: string;
  supplier: string;
  reference: string;
  validUntil: string;
  rate: number;
  extras: number;
  available: boolean;
  comparable: boolean;
}

export interface PlannedLabour {
  id: string;
  estimateId: string;
  description: string;
  trade: string;
  quantity: number;
  uom: string;
  hoursPerUnit: number;
  factor: number;
  workers: number;
  maxWorkers: number;
  rate: number;
  evidence: string;
  assumption: string;
  crewMix: string;
  quotes: CostQuote[];
}

export interface PlannedEquipment {
  id: string;
  name: string;
  days: number;
  units: number;
  rate: number;
  basis: "hr" | "day";
  extras: number;
  requirement: string;
  quotes: CostQuote[];
}

export interface CostPlan {
  labour: PlannedLabour[];
  equipment: PlannedEquipment[];
  uncertainties: string[];
  exclusions: string[];
  context: string;
  targetDays: number;
  fingerprint: string;
  useInBid: boolean;
  /** Who approved the proposal for the bid and when; cleared whenever approval is revoked. */
  approvedBy?: string;
  approvedAt?: string;
  approvedBasis?: string;
}

export interface CostTakeoff {
  id: string;
  description: string;
  trade: string;
  qty: number;
  uom: string;
}

export const takeoffFingerprint = (lines: CostTakeoff[]) =>
  JSON.stringify([...lines].sort((a, b) => a.id.localeCompare(b.id)));

const positive = (value: number) => Number.isFinite(value) && value > 0 ? value : 0;

export function labourEffort(line: PlannedLabour, shift: number, targetDays: number) {
  const hours = positive(line.quantity) * positive(line.hoursPerUnit) * positive(line.factor);
  const workers = Math.max(1, Math.floor(positive(line.workers)));
  const days = shift > 0 ? hours / (workers * shift) : 0;
  const requiredWorkers = shift > 0 && targetDays > 0 ? Math.ceil(hours / (shift * targetDays)) : 0;
  return { hours, days, requiredWorkers, capacityExceeded: requiredWorkers > line.maxWorkers };
}

/** Compare only documented, available, same-scope quotes; extras are fixed CAD costs. */
export function rankQuotes(quotes: CostQuote[], quantity: number, today: string) {
  return quotes
    .filter(q => q.available && q.comparable && q.supplier.trim() && q.reference.trim()
      && /^\d{4}-\d{2}-\d{2}$/.test(q.validUntil) && q.validUntil >= today
      && q.rate > 0 && Number.isFinite(q.rate) && q.extras >= 0 && Number.isFinite(q.extras))
    .map(q => ({ ...q, total: q.rate * positive(quantity) + q.extras }))
    .sort((a, b) => a.total - b.total);
}

export function pricePlan(plan: CostPlan, shift: number, today: string) {
  const labour = plan.labour.map(line => {
    const effort = labourEffort(line, shift, plan.targetDays);
    const quote = rankQuotes(line.quotes, effort.hours, today)[0];
    const cost = quote?.total ?? effort.hours * positive(line.rate);
    return { ...effort, trade: line.description, workerDays: shift > 0 ? effort.hours / shift : 0,
      tasks: 1, rate: quote?.rate ?? line.rate, cost, quoteId: quote?.id,
      quoted: Boolean(quote), priced: Boolean(quote) || line.rate > 0 };
  });
  const equipment = plan.equipment.map(line => {
    const days = positive(line.days) * positive(line.units);
    const hours = days * positive(shift);
    const quantity = line.basis === "hr" ? hours : days;
    const quote = rankQuotes(line.quotes, quantity, today)[0];
    return { key: line.name, days, hours, tasks: 1, unit: line.basis,
      rate: quote?.rate ?? line.rate, cost: quote?.total ?? quantity * positive(line.rate) + positive(line.extras),
      quoteId: quote?.id, quoted: Boolean(quote), priced: Boolean(quote) || line.rate > 0 };
  });
  return { labour, equipment, complete: labour.length + equipment.length > 0 &&
    labour.every(l => l.priced && l.hours > 0) && equipment.every(e => e.priced && e.days > 0),
    labourTotal: labour.reduce((sum, l) => sum + l.cost, 0), equipmentTotal: equipment.reduce((sum, e) => sum + e.cost, 0) };
}

/** The selected quote matters even when its replacement price is numerically equal. */
export function costApprovalBasis(inputBasis: string, prices: ReturnType<typeof pricePlan>) {
  return JSON.stringify([inputBasis,
    prices.labour.map(line => [line.hours, line.rate, line.cost, line.quoteId]),
    prices.equipment.map(line => [line.days, line.hours, line.unit, line.rate, line.cost, line.quoteId]),
  ]);
}

export function approvalApplies(plan: CostPlan, currentBasis: string, complete: boolean) {
  return plan.useInBid && complete && Boolean(plan.approvedBy && plan.approvedAt && plan.approvedBasis === currentBasis);
}

export function commercialTotals(parts: {
  labour: number; equipment: number; materials: number; fuel: number;
}, overheadPct: number, profitPct: number) {
  const directTotal = parts.labour + parts.equipment + parts.materials + parts.fuel;
  const overhead = directTotal * (overheadPct / 100);
  const profit = (directTotal + overhead) * (profitPct / 100);
  return { directTotal, overhead, profit, grandTotal: directTotal + overhead + profit };
}
