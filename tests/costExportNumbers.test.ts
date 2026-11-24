import { test, expect } from "bun:test";
import { costExportNumber } from "../src/lib/costExportNumbers";

test("cost exports retain verified overhead, profit and total cents", () => {
  expect(costExportNumber(2129.30)).toBe(2129.30);
  expect(costExportNumber(2342.23)).toBe(2342.23);
  expect(costExportNumber(25764.53)).toBe(25764.53);
  expect(costExportNumber(6253.28)).toBe(6253.28);
});