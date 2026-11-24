import { expect, test } from "bun:test";
import { calcBuildingQty } from "../src/lib/buildingQuantities";

import { civilTakeoffUnit } from "../supabase/functions/_shared/civil-volume";
test("civil excavation stays cubic metres and retains fractional volumes", () => {
  expect(calcBuildingQty({ quantity: 1, length: 3200.75, width: 0, uom: "m3" })).toBe(3200.75);
  expect(calcBuildingQty({ quantity: 2, length: 1200, width: 0, uom: "m3" })).toBe(2400);
});
test("documented tonnes are not silently converted from cubic metres", () => {
  expect(calcBuildingQty({ quantity: 1, length: 1450.25, width: 0, uom: "t" })).toBe(1450.25);
});
test("existing mechanical metres and building areas remain unchanged", () => {
  expect(calcBuildingQty({ quantity: 1, length: 12.5, width: 0, uom: "m" })).toBe(12.5);
  expect(calcBuildingQty({ quantity: 1, length: 100, width: 60, uom: "m2" })).toBe(6000);
  expect(calcBuildingQty({ quantity: 2, length: 0, width: 0, uom: "ea" })).toBe(2);
});
test("civil volume displays keep bank, loose, and compacted labels distinct", () => {
  expect(civilTakeoffUnit("civil", "m3", "STR01 — 1200 BANK m³")).toBe("BCM");
  expect(civilTakeoffUnit("civil", "m3", "Truck had 24 m3 (loose)")).toBe("LCM");
  expect(civilTakeoffUnit("civil", "m3", "900 compacted cubic metres")).toBe("CCM");
  expect(civilTakeoffUnit("civil", "m3", "1200 BCM or 900 CCM; scope uncertain")).toBe("m³ — basis unverified");
  expect(civilTakeoffUnit("civil", "m3", "Fill 10 m³, basis missing")).toBe("m³ — basis unverified");
  expect(civilTakeoffUnit("mechanical", "m3", "Vessel capacity")).toBe("m3");
});
