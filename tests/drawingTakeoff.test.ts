import { expect, test } from "bun:test";
import { readDrawingTakeoff } from "../src/lib/drawingTakeoff";

test("an unreadable tool result does not discard valid mechanical quantities", () => {
  const result = readDrawingTakeoff({ tool_calls: [
    { function: { name: "add_items", arguments: "{broken" } },
    { function: { name: "add_building_items", arguments: JSON.stringify({ items: [{ trade: "mechanical", description: "Valve V-101", quantity: 1 }] }) } },
  ] });
  expect(result.building).toHaveLength(1);
  expect(result.building[0].quantity).toBe(1);
  expect(result.audits[0].uncertainties).toHaveLength(1);
});

test("a mechanical drawing is accepted without concrete", () => {
  const result = readDrawingTakeoff({ tool_calls: [{ function: {
    name: "add_building_items", arguments: JSON.stringify({ items: [
      { trade: "mechanical", description: "DN100 pipe", quantity: 1, length: 12.5, uom: "m", note: "M-101 BOM measured" },
      { trade: "mechanical", description: "Valve V-101", quantity: 1, uom: "ea" },
    ] }),
  } }] });
  expect(result.concrete).toHaveLength(0);
  expect(result.count).toBe(2);
  expect(result.building[0].length).toBe(12.5);
  expect(result.building[0].trade).toBe("mechanical");
});

test("mixed drawing scope retains both disciplines and evidence", () => {
  const result = readDrawingTakeoff({ tool_calls: [
    { function: { name: "add_items", arguments: JSON.stringify({ items: [{ category: "slab", description: "Pad" }] }) } },
    { function: { name: "add_building_items", arguments: JSON.stringify({ items: [{ trade: "electrical", description: "Panel" }], drawingAudit: { sheetsRead: ["E-101"], uncertainties: ["Cable lengths absent"] } }) } },
  ] });
  expect(result.count).toBe(2);
  expect(result.concrete[0].category).toBe("slab");
  expect(result.building[0].trade).toBe("electrical");
  expect(result.audits[0].uncertainties).toEqual(["Cable lengths absent"]);
});