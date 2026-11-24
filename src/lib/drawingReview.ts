import type { DrawingAudit, DrawingLine } from "./drawingTakeoff";

export const withDrawingIds = (lines: DrawingLine[]) => lines.map(line => ({ ...line, id: crypto.randomUUID() }));
export function mergeDrawingAudit(a?: DrawingAudit | null, b?: DrawingAudit | null): Required<DrawingAudit> {
  const union = (key: keyof DrawingAudit) => [...new Set([...(a?.[key] ?? []), ...(b?.[key] ?? [])])];
  return { sheetsRead: union("sheetsRead"), uncertainties: union("uncertainties"), exclusions: union("exclusions") };
}

/** Only persisted data becomes visible and a failed approval retains its stable identities. */
export async function approveDrawingRows<T>(rows: T[], save: (rows: T[]) => Promise<{ error: unknown }>, publish: () => void) {
  const { error } = await save(rows);
  if (error) throw error;
  publish();
}

const normalizeKeyPart = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
/** Descriptions often gain a per-part suffix like "- Line M-101"; identity is the item itself. */
const normalizeDescription = (value: unknown) => normalizeKeyPart(value).split(/\s+[-–—]\s+/)[0];
const normalizeQty = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(4) : normalizeKeyPart(value);
};

/** Line IDs / equipment tags (M-101, HW-2001-A, P-12) are the only text that proves two lines are the same physical item. */
const TAG_PATTERN = /\b[A-Z]{1,6}\d{0,4}-[A-Z0-9]*\d[A-Z0-9]*(?:-[A-Z0-9]+)*\b/gi;
export const extractDrawingTags = (description: unknown) =>
  [...new Set((String(description ?? "").match(TAG_PATTERN) ?? []).map(t => t.toUpperCase()))].sort();

export interface DrawingPart<T> { source: string; lines: T[] }
export interface ReconcileResult<T> { lines: T[]; duplicatesRemoved: number; untaggedMerges: number; quantityConflicts: number }

/** Quantity a line represents (count × length/area where given), used to compare tagged repeats. */
const lineAmount = (l: DrawingLine) => {
  const q = Number(l.quantity ?? l.unit_qty ?? 1);
  const size = Number(l.length ?? l.area ?? 1);
  return (Number.isFinite(q) ? q : 1) * (Number.isFinite(size) && size > 0 ? size : 1);
};

/**
 * Reconciles lines from independently analyzed parts of drawings.
 * - Lines inside one part are never merged: the reader listed them separately, so they are separate items
 *   (two identical untagged pipe runs on one sheet stay two runs).
 * - Across parts of the SAME source file, a repeated view/BOM shows the same set again, so each identity
 *   keeps the largest count any single part reported (multiset maximum), never fewer.
 * - Different source files are never reconciled against each other.
 * - Tags are part of identity: different tags are different items; untagged merges are reported for review.
 */
export function reconcileDrawingParts<T extends DrawingLine>(parts: DrawingPart<T>[]): ReconcileResult<T> {
  type Bucket = { lines: T[]; tagged: boolean };
  const out: T[] = [];
  let duplicatesRemoved = 0;
  let untaggedMerges = 0;
  let quantityConflicts = 0;
  const bySource = new Map<string, DrawingPart<T>[]>();
  for (const part of parts) bySource.set(part.source, [...(bySource.get(part.source) ?? []), part]);
  for (const sourceParts of bySource.values()) {
    const best = new Map<string, Bucket>();
    const order: string[] = [];
    for (const part of sourceParts) {
      const local = new Map<string, Bucket>();
      for (const line of part.lines) {
        const tags = extractDrawingTags(line.description);
        const unitKey = [normalizeKeyPart(line.uom ?? line.unit), normalizeKeyPart(line.trade ?? line.category)];
        // A tag names one physical item, so a tagged line keeps its identity however each part words it.
        const key = tags.length
          ? ["tag", tags.join(","), ...unitKey].join("|")
          : [normalizeDescription(line.description), normalizeQty(line.quantity ?? line.unit_qty), ...unitKey].join("|");
        const b = local.get(key) ?? { lines: [], tagged: tags.length > 0 };
        b.lines.push({ ...line });
        local.set(key, b);
      }
      for (const [key, b] of local) {
        const prev = best.get(key);
        if (!prev) { best.set(key, b); order.push(key); continue; }
        const removed = Math.min(prev.lines.length, b.lines.length);
        duplicatesRemoved += removed;
        if (!b.tagged) untaggedMerges += removed;
        const size = (x: Bucket) => x.lines.reduce((s, l) => s + lineAmount(l), 0);
        if (b.tagged && size(b) !== size(prev)) quantityConflicts += 1;
        const [keep, drop] = b.lines.length > prev.lines.length || (b.lines.length === prev.lines.length && size(b) > size(prev)) ? [b, prev] : [prev, b];
        drop.lines.forEach((d, i) => {
          const target = keep.lines[i];
          const note = normalizeKeyPart(d.note);
          if (target && note && !normalizeKeyPart(target.note).includes(note)) {
            target.note = target.note ? `${target.note} | ${d.note}` : d.note;
          }
        });
        best.set(key, keep);
      }
    }
    for (const key of order) out.push(...best.get(key)!.lines);
  }
  return { lines: out, duplicatesRemoved, untaggedMerges, quantityConflicts };
}

/** Plain-language audit notes for a reconciliation. */
export function reconcileUncertainties(r: { duplicatesRemoved: number; untaggedMerges: number; quantityConflicts?: number }) {
  const notes: string[] = [];
  if (r.quantityConflicts) notes.push(`${r.quantityConflicts} tagged item${r.quantityConflicts > 1 ? "s" : ""} showed different quantities on different parts; the larger quantity was kept. Check the drawing.`);
  if (r.duplicatesRemoved) notes.push(`${r.duplicatesRemoved} line${r.duplicatesRemoved > 1 ? "s" : ""} repeated across parts of the same drawing were counted once.`);
  if (r.untaggedMerges) notes.push(`${r.untaggedMerges} of those had no line ID or tag, so VoxPlan could not prove they are the same item. Confirm against the drawing; separate runs with identical length and description must be added back.`);
  return notes;
}

/** Uncertainty recorded whenever one drawing was analyzed as multiple independent parts. */
export const MULTIPART_REVIEW_UNCERTAINTY =
  "This drawing was analyzed in multiple parts. Repeated views, BOMs and cross-page references were reconciled by matching identity, but review the lines before saving.";
