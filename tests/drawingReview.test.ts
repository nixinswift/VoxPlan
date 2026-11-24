import { describe, expect, it, test } from "bun:test";
import { reconcileDrawingParts, reconcileUncertainties, mergeDrawingAudit, MULTIPART_REVIEW_UNCERTAINTY } from "../src/lib/drawingReview";

const pipe = (note?: string, description = "DN100 SCH40 pipe") => ({ description, quantity: 12.5, uom: "m", trade: "mechanical", note });

describe("reconcileDrawingParts", () => {
  it("counts the same line repeated in two parts of one drawing once and keeps both evidence notes", () => {
    const r = reconcileDrawingParts([
      { source: "a.pdf", lines: [pipe("Sheet M-101 BOM")] },
      { source: "a.pdf", lines: [{ ...pipe("Sheet M-102 isometric"), description: "dn100  sch40 pipe", uom: "M" }] },
    ]);
    expect(r.lines).toHaveLength(1);
    expect(r.duplicatesRemoved).toBe(1);
    expect(r.lines[0].note).toContain("M-101");
    expect(r.lines[0].note).toContain("M-102");
  });

  it("keeps two identical untagged runs listed in the same part", () => {
    const r = reconcileDrawingParts([{ source: "a.pdf", lines: [pipe(), pipe()] }]);
    expect(r.lines).toHaveLength(2);
    expect(r.duplicatesRemoved).toBe(0);
  });

  it("keeps the larger count when a later part repeats only some of the runs", () => {
    const r = reconcileDrawingParts([
      { source: "a.pdf", lines: [pipe(), pipe()] },
      { source: "a.pdf", lines: [pipe()] },
    ]);
    expect(r.lines).toHaveLength(2);
    expect(r.duplicatesRemoved).toBe(1);
    expect(r.untaggedMerges).toBe(1);
  });

  it("keeps identical lengths with different line IDs as separate items", () => {
    const r = reconcileDrawingParts([
      { source: "a.pdf", lines: [pipe(undefined, "DN100 SCH40 pipe - Line HW-101")] },
      { source: "a.pdf", lines: [pipe(undefined, "DN100 SCH40 pipe - Line HW-102")] },
    ]);
    expect(r.lines).toHaveLength(2);
    expect(r.duplicatesRemoved).toBe(0);
  });

  it("merges the same line ID repeated across parts without flagging it as unproven", () => {
    const r = reconcileDrawingParts([
      { source: "a.pdf", lines: [pipe(undefined, "DN100 pipe - Line HW-101")] },
      { source: "a.pdf", lines: [pipe(undefined, "DN100 pipe - Line HW-101")] },
    ]);
    expect(r.lines).toHaveLength(1);
    expect(r.untaggedMerges).toBe(0);
  });

  it("never merges lines from different uploaded files", () => {
    const r = reconcileDrawingParts([
      { source: "a.pdf", lines: [pipe()] },
      { source: "b.pdf", lines: [pipe()] },
    ]);
    expect(r.lines).toHaveLength(2);
  });

  it("keeps lines that differ in quantity, unit or trade", () => {
    const r = reconcileDrawingParts([
      { source: "a.pdf", lines: [pipe(), { ...pipe(), quantity: 8 }, { ...pipe(), uom: "ft" }] },
      { source: "a.pdf", lines: [{ ...pipe(), trade: "structural" }] },
    ]);
    expect(r.lines).toHaveLength(4);
  });

  it("tells the reviewer when untagged lines were merged", () => {
    expect(reconcileUncertainties({ duplicatesRemoved: 1, untaggedMerges: 1 }).join(" ")).toContain("added back");
  });
});

describe("mergeDrawingAudit", () => {
  it("unions audit fields without duplicating strings", () => {
    const merged = mergeDrawingAudit(
      { sheetsRead: ["M-101"], uncertainties: [" illegible tag "], exclusions: [] },
      { sheetsRead: ["M-101", "M-102"], uncertainties: [" illegible tag "], exclusions: ["Electrical scope"] },
    );
    expect(merged.sheetsRead).toEqual(["M-101", "M-102"]);
    expect(merged.exclusions).toEqual(["Electrical scope"]);
  });

  it("exposes the multipart review uncertainty text", () => {
    expect(MULTIPART_REVIEW_UNCERTAINTY).toContain("multiple parts");
  });
});

test("tagged repeats reworded across parts are counted once; distinct valve tags stay separate", () => {
  const m = "mechanical";
  const r = reconcileDrawingParts([
    { source: "qa.pdf", lines: [
      { description: "VALVE-V01: DN100 gate valve (North)", quantity: 1, uom: "ea", trade: m },
      { description: "VALVE-V02: DN100 gate valve (South)", quantity: 1, uom: "ea", trade: m },
      { description: "PIPE-P01: DN100 carbon steel pipe", quantity: 1, length: 12.5, uom: "m", trade: m },
    ] },
    { source: "qa.pdf", lines: [
      { description: "DN100 gate valve - North (VALVE-V01)", quantity: 1, uom: "ea", trade: m },
      { description: "DN100 gate valve - South (VALVE-V02)", quantity: 1, uom: "ea", trade: m },
      { description: "DN100 carbon steel pipe (PIPE-P01)", quantity: 1, length: 12.5, uom: "m", trade: m },
    ] },
  ]);
  expect(r.lines).toHaveLength(3);
  expect(r.duplicatesRemoved).toBe(3);
  expect(r.quantityConflicts).toBe(0);
});

test("same tag with different quantities keeps the larger and is flagged", () => {
  const r = reconcileDrawingParts([
    { source: "a.pdf", lines: [{ description: "FLANGE-F01 flange", quantity: 6, uom: "ea", trade: "mechanical" }] },
    { source: "a.pdf", lines: [{ description: "DN100 flange (FLANGE-F01)", quantity: 8, uom: "ea", trade: "mechanical" }] },
  ]);
  expect(r.lines).toHaveLength(1);
  expect(r.lines[0].quantity).toBe(8);
  expect(r.quantityConflicts).toBe(1);
});
