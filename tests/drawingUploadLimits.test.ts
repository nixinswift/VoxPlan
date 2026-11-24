import { expect, test } from "bun:test";
import { exceedsDrawingFileLimit, MAX_DRAWING_FILE_BYTES } from "../src/lib/drawingUploadLimits";

test("drawing uploads accept larger files up to 50 MB inclusive", () => {
  expect(exceedsDrawingFileLimit(21 * 1024 * 1024)).toBe(false);
  expect(exceedsDrawingFileLimit(50 * 1024 * 1024)).toBe(false);
  expect(MAX_DRAWING_FILE_BYTES).toBe(52428800);
  expect(exceedsDrawingFileLimit(52428801)).toBe(true);
});