import { Task } from "@/types/schedule";
import { parseEquipment, findingScore } from "../../supabase/functions/_shared/resource-equipment";
export { parseEquipment } from "../../supabase/functions/_shared/resource-equipment";

/**
 * Deterministic construction scheduling engine.
 *
 * Replaces "ask the LLM for dates" with a real forward-pass CPM-style
 * scheduler that respects:
 *  - a working calendar (weekends + project holidays)
 *  - construction phase sequencing (asbestos -> demo -> civil -> concrete ->
 *    structural -> MEP -> finishes -> general)
 *  - equipment availability (a single JLG cannot be on two activities at once)
 *  - trade worker pools (shared crews cannot exceed the available headcount)
 */

export interface ResourceConstraint {
  type: "workers" | "equipment";
  name: string;
  available: number;
}

export interface EngineOptions {
  /** Construction templates are assumptions, not actual task dependencies. Opt in explicitly. */
  inferConstructionSequencing?: boolean;
  /** ISO date strings (YYYY-MM-DD) of non-working days. */
  holidays?: string[];
  workSaturday?: boolean;
  workSunday?: boolean;
  constraints?: ResourceConstraint[];
  /** Assume 1 unit of any named piece of equipment when no constraint is given. */
  assumeSingleEquipment?: boolean;
  /** Earliest date the crew can mobilize. Defaults to the earliest task start. */
  projectStart?: Date;
  /**
   * How many envelope trades can physically occupy the elevations at once.
   * Prevents "everybody descends on the same unfinished wall" schedules.
   */
  workFronts?: number;

}

export interface PlanTask {
  id: string;
  name: string;
  trade: string;
  phase: number;
  phaseLabel: string;
  manpower: number;
  duration: number;
  equipment: string[];
  originalStart: Date;
  start: Date;
  finish: Date;
  shiftedDays: number;
}

export type IssueType =
  | "sequence"
  | "calendar"
  | "gap"
  | "equipment"
  | "manpower"
  | "duration"
  | "parallel";

export interface Issue {
  type: IssueType;
  severity: "high" | "medium" | "low";
  taskId: string | null;
  taskName: string;
  issue: string;
  recommendation: string;
  proposedStartDate: string | null;
}

export interface DayLoad {
  date: Date;
  workers: number;
  tasks: string[];
}

export interface Plan {
  canApply: boolean;
  tasks: PlanTask[];
  issues: Issue[];
  score: number;
  summary: string;
  originalStart: Date | null;
  originalFinish: Date | null;
  optimizedStart: Date | null;
  optimizedFinish: Date | null;
  originalWorkingDays: number;
  optimizedWorkingDays: number;
  daysSaved: number;
  peakWorkers: number;
  optimizedPeakWorkers: number;
  loadByDay: DayLoad[];
}

/* ------------------------------------------------------------------ */
/* Phases                                                              */
/* ------------------------------------------------------------------ */

/**
 * Relationship to a predecessor phase.
 *  FS = cannot start until the predecessor phase finishes.
 *  SS = can start `lag` working days after the predecessor phase STARTS
 *       (controlled overlap: the predecessor releases work fronts /
 *       elevations as it moves around the building).
 */
export interface PhaseLink {
  rank: number;
  rel: "FS" | "SS";
  lag: number;
}

export interface PhaseDef {
  rank: number;
  label: string;
  match: RegExp;
  /** Explicit predecessors. Hazmat + demolition are always implied. */
  preds: PhaseLink[];
}

const PHASES: PhaseDef[] = [
  { rank: 1, label: "Asbestos / Hazmat", match: /asbestos|hazmat|abatement|mould|lead/, preds: [] },
  { rank: 2, label: "Demolition", match: /demo|strip.?out|removal|tear.?out/, preds: [] },
  {
    rank: 3,
    label: "Civil / Site",
    match: /civil|site.?work|excavat|earthwork|shoring|grading|backfill|underground/,
    preds: [],
  },
  {
    rank: 4,
    label: "Concrete",
    match: /concrete|formwork|rebar|reinforc|pour|footing|slab|foundation|grout|cutting|grinding|core/,
    preds: [{ rank: 3, rel: "SS", lag: 2 }],
  },
  {
    rank: 5,
    label: "Structural / Framing",
    match: /structur|steel|erection|masonry|stud|framing|blocking|joist/,
    preds: [{ rank: 4, rel: "FS", lag: 0 }],
  },
  // ---- Building envelope: sequenced by released work fronts ----
  {
    rank: 6,
    label: "Sheathing / Re-sheeting",
    match: /sheath|sheet(ing)?|re.?sheet|plywood|osb|densglass|exterior board/,
    preds: [{ rank: 5, rel: "FS", lag: 0 }],
  },
  {
    rank: 7,
    label: "WRB / Air barrier (Tyvek)",
    match: /tyvek|w\.?r\.?b|weather.?barrier|air.?barrier|house.?wrap|building wrap|vapour barrier|vapor barrier|peel.?and.?stick/,
    // Tyvek follows the first sheeted elevation, ~2 days behind sheathing.
    preds: [{ rank: 6, rel: "SS", lag: 2 }],
  },
  {
    rank: 8,
    label: "Exterior insulation",
    match: /(rigid|exterior|continuous|board|3\/8|1\/2|foam|eps|xps|mineral wool).*insulat|insulat.*(rigid|exterior|board|sheath)/,
    preds: [{ rank: 7, rel: "SS", lag: 1 }],
  },
  {
    rank: 9,
    label: "Openings (windows / doors)",
    match: /window|door|glazing|curtain wall|storefront|louver/,
    // Openings need a WRB'd, insulated front to land in.
    preds: [
      { rank: 7, rel: "SS", lag: 4 },
      { rank: 8, rel: "SS", lag: 3 },
    ],
  },
  {
    rank: 10,
    label: "Flashing / envelope metal",
    match: /flash|trim metal|envelope metal|cap metal|z.?bar|closure|sealant|caulk/,
    preds: [
      { rank: 8, rel: "SS", lag: 3 },
      { rank: 9, rel: "SS", lag: 0 },
    ],
  },
  {
    rank: 11,
    label: "Siding / cladding",
    match: /siding|cladding|panel|stucco|brick veneer|acm|hardie|soffit|fascia/,
    preds: [
      { rank: 8, rel: "SS", lag: 5 },
      { rank: 9, rel: "SS", lag: 2 },
    ],

  },
  {
    rank: 12,
    label: "Roofing / final metal",
    match: /roof|gutter|downspout|eaves|final metal|membrane|flashing final/,
    preds: [{ rank: 11, rel: "SS", lag: 8 }],
  },
  {
    rank: 13,
    label: "Rough-in (MEP)",
    match: /electrical|mechanical|plumb|hvac|sprinkler|fire.?protection|rough.?in|duct/,
    // Runs in parallel with the envelope once the structure is up.
    preds: [{ rank: 5, rel: "FS", lag: 0 }],
  },
  {
    rank: 14,
    label: "Interior insulation / Drywall",
    match: /insulat|batt|drywall|boarding|taping|gypsum|attic/,
    preds: [{ rank: 13, rel: "SS", lag: 3 }],
  },
  {
    rank: 15,
    label: "Finishes",
    match: /finish|paint|floor|trim|ceiling|millwork|tile/,
    preds: [{ rank: 14, rel: "FS", lag: 0 }],
  },
  {
    rank: 16,
    label: "QA/QC & Closeout",
    match: /general|commission|closeout|punch|deficien|clean|qa\/qc|qaqc|inspection|turnover/,
    preds: [
      { rank: 11, rel: "FS", lag: 0 },
      { rank: 12, rel: "FS", lag: 0 },
      { rank: 15, rel: "FS", lag: 0 },
    ],
  },
];

const PHASE_BY_RANK = new Map(PHASES.map((p) => [p.rank, p]));

/** Envelope phases that physically share elevations / work fronts. */
const ENVELOPE_RANKS = [6, 7, 8, 9, 10, 11, 12];

const DEFAULT_PHASE: PhaseDef = {
  rank: 0,
  label: "Independent / unclassified work",
  match: /$^/,
  preds: [],
};

export const getPhase = (task: { trade?: string; name?: string }): PhaseDef => {
  const clean = (s?: string) => (s ?? "").toLowerCase().replace(/_/g, " ");
  const name = clean(task.name);
  // Inspections and recurring servicing are not construction installations.
  // Keep their intended dates and do not invent dependencies from trade labels.
  if (/inspection|inspect\b|maintenance|servic(e|ing)|cleaning|seal coating|load test|suppression test|annual.*test/.test(name)) {
    return DEFAULT_PHASE;
  }
  // The activity NAME is the strongest signal ("Re-sheeting" filed under the
  // structural trade is still sheathing, not framing).
  for (const p of PHASES) {
    if (name && p.match.test(name)) return p;
  }
  const haystack = `${clean(task.trade)} ${name}`;
  for (const p of PHASES) {
    if (p.match.test(haystack)) return p;
  }
  return DEFAULT_PHASE;
};



/* ------------------------------------------------------------------ */
/* Calendar helpers                                                    */
/* ------------------------------------------------------------------ */

export const toISO = (d: Date) => {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
};

class Calendar {
  private holidays: Set<string>;
  constructor(holidays: string[] = [], private workSaturday = false, private workSunday = false) {
    this.holidays = new Set(holidays.map((h) => h.slice(0, 10)));
  }

  isWorkingDay(d: Date) {
    const dow = d.getDay();
    if (dow === 0 && !this.workSunday) return false;
    if (dow === 6 && !this.workSaturday) return false;
    return !this.holidays.has(toISO(d));
  }

  next(d: Date) {
    let cur = dayStart(d);
    let guard = 0;
    while (!this.isWorkingDay(cur) && guard++ < 400) cur = addDays(cur, 1);
    return cur;
  }

  /** Inclusive list of working days covering `duration` working days from start. */
  workingDays(start: Date, duration: number) {
    const days: Date[] = [];
    const target = Math.max(1, Math.round(duration || 1));
    // Persisted duration is a calendar span; never expand it behind the user's back.
    for (let i = 0; i < target; i++) {
      const cur = addDays(dayStart(start), i);
      if (!this.holidays.has(toISO(cur))) days.push(cur);
    }
    return days;
  }

  countWorkingDays(from: Date, to: Date) {
    if (to < from) return 0;
    let cur = dayStart(from);
    const end = dayStart(to);
    let n = 0;
    let guard = 0;
    while (cur <= end && guard++ < 5000) {
      if (this.isWorkingDay(cur)) n++;
      cur = addDays(cur, 1);
    }
    return n;
  }
}


/* ------------------------------------------------------------------ */
/* Core engine                                                         */
/* ------------------------------------------------------------------ */

export const buildPlan = (tasks: Task[], options: EngineOptions = {}): Plan => {
  const cal = new Calendar(options.holidays ?? [], options.workSaturday, options.workSunday);
  const assumeSingleEquipment = options.assumeSingleEquipment !== false;

  const workerCaps = new Map<string, number>();
  const equipmentCaps = new Map<string, number>();
  (options.constraints ?? []).forEach((c) => {
    const key = c.name.trim().toLowerCase();
    if (!key || !Number.isFinite(c.available)) return;
    if (c.type === "workers") workerCaps.set(key, c.available);
    else equipmentCaps.set(key, Math.max(1, c.available));
  });

  const empty: Plan = {
    canApply: true,
    tasks: [],
    issues: [],
    score: 100,
    summary: "No activities to optimize yet.",
    originalStart: null,
    originalFinish: null,
    optimizedStart: null,
    optimizedFinish: null,
    originalWorkingDays: 0,
    optimizedWorkingDays: 0,
    daysSaved: 0,
    peakWorkers: 0,
    optimizedPeakWorkers: 0,
    loadByDay: [],
  };
  if (!tasks.length) return empty;

  const prepared = tasks.map((t) => {
    const phase = options.inferConstructionSequencing ? getPhase(t) : DEFAULT_PHASE;
    return {
      task: t,
      phase: phase.rank,
      phaseLabel: phase.label,
      duration: Math.max(1, Math.round(t.duration || 1)),
      manpower: Math.max(0, Math.round(t.manpower || 0)),
      equipment: parseEquipment(t.equipment),
      originalStart: dayStart(new Date(t.startDate)),
    };
  });

  const projectStart = cal.next(
    options.projectStart
      ? dayStart(options.projectStart)
      : new Date(Math.min(...prepared.map((p) => p.originalStart.getTime())))
  );

  // Original metrics (before optimization)
  const originalStart = new Date(Math.min(...prepared.map((p) => p.originalStart.getTime())));
  const originalFinishDates = prepared.map((p) => {
    return addDays(p.originalStart, p.duration - 1);
  });
  const originalFinish = new Date(Math.max(...originalFinishDates.map((d) => d.getTime())));

  // Sort: phase, then original intent, then longest first (helps leveling)
  const order = [...prepared].sort(
    (a, b) =>
      a.phase - b.phase ||
      a.originalStart.getTime() - b.originalStart.getTime() ||
      b.duration - a.duration
  );
  const preparedById = new Map(prepared.map(p => [p.task.id, p]));
  const dependencyProblems: Issue[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const sorted: typeof order = [];
  const visit = (p: typeof order[number]) => {
    if (visited.has(p.task.id)) return;
    if (visiting.has(p.task.id)) {
      dependencyProblems.push({ type: "sequence", severity: "high", taskId: p.task.id, taskName: p.task.name, issue: "Explicit task dependencies contain a cycle.", recommendation: "Correct the dependency cycle before applying a plan.", proposedStartDate: null });
      return;
    }
    visiting.add(p.task.id);
    for (const id of p.task.predecessorIds ?? []) {
      const predecessor = preparedById.get(id);
      if (predecessor) visit(predecessor);
      else dependencyProblems.push({ type: "sequence", severity: "high", taskId: p.task.id, taskName: p.task.name, issue: `Predecessor ${id} is missing from this project.`, recommendation: "Correct the dependency before applying a plan.", proposedStartDate: null });
    }
    visiting.delete(p.task.id);
    visited.add(p.task.id);
    sorted.push(p);
  };
  order.forEach(visit);

  // Occupancy: ISO date -> resource usage
  const tradeLoad = new Map<string, Map<string, number>>(); // date -> trade -> workers
  const equipLoad = new Map<string, Map<string, number>>(); // date -> equipment -> units
  const frontLoad = new Map<string, Map<string, number>>(); // date -> "envelope" -> activities
  const workFronts = Math.max(1, options.workFronts ?? 3);


  const usage = (map: Map<string, Map<string, number>>, iso: string, key: string) =>
    map.get(iso)?.get(key) ?? 0;

  const commit = (
    map: Map<string, Map<string, number>>,
    iso: string,
    key: string,
    amount: number
  ) => {
    let inner = map.get(iso);
    if (!inner) {
      inner = new Map();
      map.set(iso, inner);
    }
    inner.set(key, (inner.get(key) ?? 0) + amount);
  };

  const planned: PlanTask[] = [];
  const issues: Issue[] = [...dependencyProblems];
  let canApply = dependencyProblems.length === 0;
  const phaseFinish = new Map<number, Date>(); // phase -> latest finish
  const phaseStart = new Map<number, Date>(); // phase -> earliest start

  /** Advance `n` working days forward from a working-day start. */
  const addWorkingDays = (from: Date, n: number) => {
    let cur = cal.next(from);
    for (let i = 0; i < Math.max(0, n); i++) cur = cal.next(addDays(cur, 1));
    return cur;
  };

  /**
   * Earliest legal start for a phase, following its explicit predecessor
   * links. Predecessor phases with no activities are transparently skipped
   * (their own predecessors are used instead).
   */
  const earliestForPhase = (rank: number, seen = new Set<number>()): Date => {
    let earliest = projectStart;
    if (seen.has(rank)) return earliest;
    seen.add(rank);

    const def = PHASE_BY_RANK.get(rank) ?? DEFAULT_PHASE;
    const links: PhaseLink[] = [...def.preds];
    // Hazmat and demolition always gate everything downstream.
    if (rank > 2) {
      links.push({ rank: 1, rel: "FS", lag: 0 }, { rank: 2, rel: "FS", lag: 0 });
    }

    for (const link of links) {
      const pStart = phaseStart.get(link.rank);
      const pFinish = phaseFinish.get(link.rank);
      if (!pStart || !pFinish) {
        continue;
      }
      const candidate =
        link.rel === "FS"
          ? cal.next(addDays(pFinish, 1))
          : addWorkingDays(pStart, link.lag);
      if (candidate > earliest) earliest = candidate;
    }
    return earliest;
  };


  for (const p of sorted) {
    const tradeKey = (p.task.trade || "general").toLowerCase();
    const workerCap = workerCaps.get(tradeKey);

    let candidate = p.phase === 0 ? cal.next(p.originalStart) : earliestForPhase(p.phase);
    for (const id of p.task.predecessorIds ?? []) {
      const predecessor = planned.find(t => t.id === id);
      if (predecessor) {
        const required = cal.next(addDays(predecessor.finish, 1));
        if (required > candidate) candidate = required;
      }
    }
    const impossibleCrew = workerCap !== undefined && p.manpower > workerCap;
    if (impossibleCrew) {
      canApply = false;
      issues.push({ type: "manpower", severity: "high", taskId: p.task.id, taskName: p.task.name, issue: `This activity needs ${p.manpower} workers but the pool has ${workerCap}. Moving its date cannot solve that.`, recommendation: "Change the crew, duration or available capacity before applying.", proposedStartDate: null });
    }
    // never schedule earlier than the crew intended unless it removes idle time:
    // the engine is allowed to pull tasks earlier (that's the point), but never
    // before mobilization.
    let days = cal.workingDays(candidate, p.duration);
    let guard = 0;

    while (!impossibleCrew && guard++ < 400) {
      let conflictDay: Date | null = null;

      const isEnvelope = ENVELOPE_RANKS.includes(p.phase);

      for (const d of days) {
        const iso = toISO(d);
        if (workerCap !== undefined && usage(tradeLoad, iso, tradeKey) + p.manpower > workerCap) {
          conflictDay = d;
          break;
        }
        // Physical work fronts: only so many envelope trades can occupy the
        // elevations at the same time, regardless of headcount available.
        if (isEnvelope && usage(frontLoad, iso, "envelope") + 1 > workFronts) {
          conflictDay = d;
          break;
        }
        const equipConflict = p.equipment.find((e) => {
          const cap = equipmentCaps.get(e) ?? (assumeSingleEquipment ? 1 : Infinity);
          return usage(equipLoad, iso, e) + 1 > cap;
        });
        if (equipConflict) {
          conflictDay = d;
          break;
        }
      }


      if (!conflictDay) break;
      candidate = cal.next(addDays(conflictDay, 1));
      days = cal.workingDays(candidate, p.duration);
    }
    if (guard >= 400) canApply = false;

    const start = candidate;
    const finish = addDays(start, p.duration - 1);

    days.forEach((d) => {
      const iso = toISO(d);
      commit(tradeLoad, iso, tradeKey, p.manpower);
      if (ENVELOPE_RANKS.includes(p.phase)) commit(frontLoad, iso, "envelope", 1);
      p.equipment.forEach((e) => commit(equipLoad, iso, e, 1));
    });

    const prevFinish = phaseFinish.get(p.phase);
    if (!prevFinish || finish > prevFinish) phaseFinish.set(p.phase, finish);
    const prevStart = phaseStart.get(p.phase);
    if (!prevStart || start < prevStart) phaseStart.set(p.phase, start);


    const shiftedDays = Math.round(
      (start.getTime() - p.originalStart.getTime()) / (1000 * 60 * 60 * 24)
    );

    planned.push({
      id: p.task.id,
      name: p.task.name,
      trade: p.task.trade,
      phase: p.phase,
      phaseLabel: p.phaseLabel,
      manpower: p.manpower,
      duration: p.duration,
      equipment: p.equipment,
      originalStart: p.originalStart,
      start,
      finish,
      shiftedDays,
    });
  }

  /* ---------------- diagnostics on the CURRENT schedule ---------------- */

  const byId = new Map(planned.map((p) => [p.id, p]));

  // 1. Non-working start dates
  prepared.forEach((p) => {
    if (!cal.isWorkingDay(p.originalStart)) {
      issues.push({
        type: "calendar",
        severity: "medium",
        taskId: p.task.id,
        taskName: p.task.name,
        issue: `Starts on a non-working day (${toISO(p.originalStart)}).`,
        recommendation: "Move the start to the next working day.",
        proposedStartDate: toISO(byId.get(p.task.id)?.start ?? cal.next(p.originalStart)),
      });
    }
  });

  // 2. Sequence violations against current dates (link-aware: controlled
  //    overlap is fine, starting before a front is released is not).
  const currentFinish = new Map<string, Date>();
  const currentStart = new Map<string, Date>();
  prepared.forEach((p) => {
    const days = cal.workingDays(p.originalStart, p.duration);
    currentStart.set(p.task.id, p.originalStart);
    currentFinish.set(p.task.id, addDays(p.originalStart, p.duration - 1));
  });
  prepared.forEach(p => {
    for (const id of p.task.predecessorIds ?? []) {
      const predecessor = preparedById.get(id);
      const finish = currentFinish.get(id);
      if (predecessor && finish && p.originalStart <= finish) {
        issues.push({ type: "sequence", severity: "high", taskId: p.task.id, taskName: p.task.name, issue: `Starts before explicit predecessor "${predecessor.task.name}" finishes on ${toISO(finish)}.`, recommendation: "Finish the recorded predecessor before this activity starts.", proposedStartDate: toISO(byId.get(p.task.id)?.start ?? cal.next(addDays(finish, 1))) });
      }
    }
  });

  const linksFor = (rank: number): PhaseLink[] => {
    const def = PHASE_BY_RANK.get(rank) ?? DEFAULT_PHASE;
    const links = [...def.preds];
    if (rank > 2) links.push({ rank: 1, rel: "FS", lag: 0 }, { rank: 2, rel: "FS", lag: 0 });
    return links;
  };

  prepared.forEach((p) => {
    for (const link of linksFor(p.phase)) {
      const preds = prepared.filter((o) => o.phase === link.rank);
      if (!preds.length) continue;
      const predLabel = PHASE_BY_RANK.get(link.rank)?.label ?? "predecessor";

      if (link.rel === "FS") {
        const latest = preds.reduce((a, b) =>
          (currentFinish.get(a.task.id) ?? a.originalStart) > (currentFinish.get(b.task.id) ?? b.originalStart) ? a : b
        );
        const predFinish = currentFinish.get(latest.task.id) ?? latest.originalStart;
        if (p.originalStart <= predFinish) {
          issues.push({
            type: "sequence",
            severity: "high",
            taskId: p.task.id,
            taskName: p.task.name,
            issue: `Starts ${toISO(p.originalStart)} but "${latest.task.name}" (${predLabel}) runs until ${toISO(predFinish)}.`,
            recommendation: `${p.phaseLabel} must follow ${predLabel} — it cannot start on an unreleased work front.`,
            proposedStartDate: toISO(byId.get(p.task.id)?.start ?? p.originalStart),
          });
          break;
        }
      } else {
        const earliestPred = preds.reduce((a, b) =>
          (currentStart.get(a.task.id) ?? a.originalStart) <= (currentStart.get(b.task.id) ?? b.originalStart) ? a : b
        );
        const predStart = currentStart.get(earliestPred.task.id) ?? earliestPred.originalStart;
        let required = cal.next(predStart);
        for (let i = 0; i < link.lag; i++) required = cal.next(addDays(required, 1));
        if (p.originalStart < required) {
          issues.push({
            type: "sequence",
            severity: "high",
            taskId: p.task.id,
            taskName: p.task.name,
            issue: `Starts ${toISO(p.originalStart)}, the same time as (or ahead of) ${predLabel} — "${earliestPred.task.name}" only starts ${toISO(predStart)}, so no elevation is released yet.`,
            recommendation: `Hold ${p.phaseLabel} until at least ${toISO(required)} (${link.lag} working days behind ${predLabel}) so the work fronts hand off in order.`,
            proposedStartDate: toISO(byId.get(p.task.id)?.start ?? required),
          });
          break;
        }
      }
    }
  });

  // 2b. Missing envelope scope (e.g. no WRB/Tyvek between sheathing and cladding)
  const ranksPresent = new Set(prepared.map((p) => p.phase));
  if (ranksPresent.has(6) && (ranksPresent.has(11) || ranksPresent.has(8)) && !ranksPresent.has(7)) {
    issues.push({
      type: "sequence",
      severity: "high",
      taskId: null,
      taskName: "WRB / Air barrier (Tyvek)",
      issue: "Sheathing and cladding/insulation are scheduled but there is no WRB / Tyvek activity in the programme.",
      recommendation:
        "Add the WRB / Tyvek scope starting ~2 working days behind sheathing; insulation, openings, flashing and siding all depend on it.",
      proposedStartDate: phaseStart.get(6) ? toISO(addWorkingDays(phaseStart.get(6) ?? projectStart, 2)) : null,
    });
  }
  if (ranksPresent.has(11) && !ranksPresent.has(16)) {
    issues.push({
      type: "sequence",
      severity: "medium",
      taskId: null,
      taskName: "QA/QC & deficiencies",
      issue: "No QA/QC or deficiency activity closes out the envelope work.",
      recommendation: "Add a 3-4 day QA/QC and deficiency window after final metal so handover is not open-ended.",
      proposedStartDate: null,
    });
  }

  // 2c. Too many envelope trades stacked on the same elevations
  const envelopeDay = new Map<string, string[]>();
  prepared
    .filter((p) => ENVELOPE_RANKS.includes(p.phase))
    .forEach((p) => {
      cal.workingDays(p.originalStart, p.duration).forEach((d) => {
        const iso = toISO(d);
        envelopeDay.set(iso, [...(envelopeDay.get(iso) ?? []), p.task.name]);
      });
    });
  const worstStack = Array.from(envelopeDay.entries()).sort((a, b) => b[1].length - a[1].length)[0];
  if (worstStack && worstStack[1].length > workFronts) {
    issues.push({
      type: "parallel",
      severity: "high",
      taskId: null,
      taskName: worstStack[1][0],
      issue: `${worstStack[1].length} envelope activities are stacked on ${worstStack[0]} (${worstStack[1].join(", ")}) — more crews than there are released elevations.`,
      recommendation: `Limit concurrent envelope fronts to ${workFronts} and stagger the rest behind the sheathing/WRB hand-off.`,
      proposedStartDate: null,
    });
  }


  // 3. Equipment double-booking on current dates
  const equipDayMap = new Map<string, Map<string, { id: string; name: string }[]>>();
  prepared.forEach((p) => {
    cal.workingDays(p.originalStart, p.duration).forEach((d) => {
      const iso = toISO(d);
      let inner = equipDayMap.get(iso);
      if (!inner) {
        inner = new Map();
        equipDayMap.set(iso, inner);
      }
      const bookings = inner;
      p.equipment.forEach((e) => bookings.set(e, [...(bookings.get(e) ?? []), { id: p.task.id, name: p.task.name }]));
    });
  });
  const reportedEquip = new Set<string>();
  equipDayMap.forEach((inner, iso) => {
    inner.forEach((names, equip) => {
      const cap = equipmentCaps.get(equip) ?? (assumeSingleEquipment ? 1 : Infinity);
      const unique = Array.from(new Map(names.map(task => [task.id, task])).values());
      if (unique.length > cap && !reportedEquip.has(equip)) {
        reportedEquip.add(equip);
        issues.push({
          type: "equipment",
          severity: "high",
          taskId: null,
          taskName: unique[0].name,
          issue: `${unique.length} activities need "${equip}" on ${iso} but only ${cap === Infinity ? "limited" : cap} available (${unique.map(task => task.name).join(", ")}).`,
          recommendation: `Stagger these activities or add another ${equip}.`,
          proposedStartDate: null,
        });
      }
    });
  });

  // 4. Trade worker pool overruns
  const tradeDayMap = new Map<string, Map<string, number>>();
  prepared.forEach((p) => {
    cal.workingDays(p.originalStart, p.duration).forEach((d) => {
      const iso = toISO(d);
      let inner = tradeDayMap.get(iso);
      if (!inner) {
        inner = new Map();
        tradeDayMap.set(iso, inner);
      }
      const key = (p.task.trade || "general").toLowerCase();
      inner.set(key, (inner.get(key) ?? 0) + p.manpower);
    });
  });
  const reportedTrade = new Set<string>();
  tradeDayMap.forEach((inner, iso) => {
    inner.forEach((workers, trade) => {
      const cap = workerCaps.get(trade);
      if (cap !== undefined && workers > cap && !reportedTrade.has(trade)) {
        reportedTrade.add(trade);
        issues.push({
          type: "manpower",
          severity: "high",
          taskId: null,
          taskName: trade.replace(/_/g, " "),
          issue: `${trade.replace(/_/g, " ")} needs ${workers} workers on ${iso} but only ${cap} are available.`,
          recommendation: "Level the crew: stagger overlapping activities or extend durations with fewer workers.",
          proposedStartDate: null,
        });
      }
    });
  });

  // 5. Idle gaps between phases on the current schedule
  const phasesPresent = Array.from(new Set(prepared.filter(p => p.phase > 0).map((p) => p.phase))).sort((a, b) => a - b);
  for (let i = 1; i < phasesPresent.length; i++) {
    const prev = prepared.filter((p) => p.phase === phasesPresent[i - 1]);
    const cur = prepared.filter((p) => p.phase === phasesPresent[i]);
    const prevEnd = new Date(Math.max(...prev.map((p) => (currentFinish.get(p.task.id) ?? p.originalStart).getTime())));
    const curStartTask = cur.reduce((a, b) => (a.originalStart <= b.originalStart ? a : b));
    const gap = cal.countWorkingDays(addDays(prevEnd, 1), addDays(curStartTask.originalStart, -1));
    if (gap >= 2) {
      issues.push({
        type: "gap",
        severity: gap >= 5 ? "high" : "medium",
        taskId: curStartTask.task.id,
        taskName: curStartTask.task.name,
        issue: `${gap} idle working days between ${prev[0].phaseLabel} and ${curStartTask.phaseLabel}.`,
        recommendation: `Pull "${curStartTask.task.name}" forward to close the gap.`,
        proposedStartDate: toISO(byId.get(curStartTask.task.id)?.start ?? curStartTask.originalStart),
      });
    }
  }

  // 6. Duration sanity
  prepared.forEach((p) => {
    if (p.manpower === 0) {
      issues.push({
        type: "duration",
        severity: "low",
        taskId: p.task.id,
        taskName: p.task.name,
        issue: "No manpower assigned, so it never shows in the workforce curve.",
        recommendation: "Assign a realistic crew size.",
        proposedStartDate: null,
      });
    }
    if (p.duration > 60) {
      issues.push({
        type: "duration",
        severity: "low",
        taskId: p.task.id,
        taskName: p.task.name,
        issue: `${p.duration} working days is very long for a single activity.`,
        recommendation: "Break it into areas or floors so progress is trackable.",
        proposedStartDate: null,
      });
    }
  });

  /* ---------------- metrics ---------------- */

  const optimizedStart = new Date(Math.min(...planned.map((p) => p.start.getTime())));
  const optimizedFinish = new Date(Math.max(...planned.map((p) => p.finish.getTime())));

  const loadMap = new Map<string, { workers: number; tasks: string[] }>();
  planned.forEach((p) => {
    cal.workingDays(p.start, p.duration).forEach((d) => {
      const iso = toISO(d);
      const entry = loadMap.get(iso) ?? { workers: 0, tasks: [] };
      entry.workers += p.manpower;
      entry.tasks.push(p.name);
      loadMap.set(iso, entry);
    });
  });
  const loadByDay: DayLoad[] = Array.from(loadMap.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([iso, v]) => ({ date: new Date(`${iso}T00:00:00`), workers: v.workers, tasks: v.tasks }));

  const peakWorkers = Math.max(0, ...Array.from(tradeDayMap.values()).map((inner) =>
    Array.from(inner.values()).reduce((a, b) => a + b, 0)
  ));
  const optimizedPeakWorkers = Math.max(0, ...loadByDay.map((d) => d.workers));

  const originalWorkingDays = cal.countWorkingDays(originalStart, originalFinish);
  const optimizedWorkingDays = cal.countWorkingDays(optimizedStart, optimizedFinish);

  const score = findingScore(issues);

  const daysSaved = originalWorkingDays - optimizedWorkingDays;
  const moved = planned.filter((p) => p.shiftedDays !== 0).length;

  const summary = issues.length
    ? `${issues.length} issue${issues.length === 1 ? "" : "s"} found. Optimized plan reschedules ${moved} activit${moved === 1 ? "y" : "ies"} and ${
        daysSaved > 0 ? `shortens the programme by ${daysSaved} working days` : daysSaved < 0 ? `adds ${Math.abs(daysSaved)} working days to resolve resource conflicts` : "keeps the same end date"
      }.`
    : "Schedule is sequenced correctly with no resource conflicts detected.";

  return {
    canApply,
    tasks: planned,
    issues,
    score,
    summary,
    originalStart,
    originalFinish,
    optimizedStart,
    optimizedFinish,
    originalWorkingDays,
    optimizedWorkingDays,
    daysSaved,
    peakWorkers,
    optimizedPeakWorkers,
    loadByDay,
  };
};
