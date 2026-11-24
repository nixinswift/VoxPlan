import { expect, test } from "bun:test";
import { concreteVolumeM3, cubicMetresToYards, concreteAreaM2 } from "../src/lib/concreteQuantities";

const slab = { category: "slab", quantity: 1, length: 3, width: 4, thickness: 0.15, height: 0, area: 0, unit: "m" };
test("1.80 m³ is 2.35 CY, and 5% waste is 1.89 m³ / 2.47 CY", () => {
  const volume = concreteVolumeM3(slab);
  expect(volume).toBeCloseTo(1.8, 10);
  expect(cubicMetresToYards(volume).toFixed(2)).toBe("2.35");
  expect((volume * 1.05).toFixed(2)).toBe("1.89");
  expect(cubicMetresToYards(volume * 1.05).toFixed(2)).toBe("2.47");
});
test("27 cubic feet equals one CY and can be combined with metric totals", () => {
  const imperial = concreteVolumeM3({ ...slab, unit: "ft", length: 3, width: 3, thickness: 3 });
  expect(cubicMetresToYards(imperial)).toBeCloseTo(1, 10);
  expect(concreteVolumeM3(slab) + imperial).toBeCloseTo(2.564554857984, 10);
});
test("walls use height and explicit area overrides length times width", () => {
  expect(concreteVolumeM3({ ...slab, category: "wall", area: 2, height: 3, thickness: 9 })).toBe(6);
});
test("D02 imperial explicit area normalizes to m² without changing one-CY volume", () => {
  const item = { ...slab, unit: "ft", area: 9, thickness: 3 };
  expect(concreteAreaM2(item)).toBeCloseTo(0.83612736, 10);
  expect(cubicMetresToYards(concreteVolumeM3(item))).toBeCloseTo(1, 10);
});