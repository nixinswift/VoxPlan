import { expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { prepareDrawingFiles } from "../src/lib/prepareDrawingFiles";

test("D05 empty-MIME PDF is normalized and corrupt PDF is rejected before analysis", async () => {
  const document = await PDFDocument.create(); document.addPage();
  const file = new File([await document.save()], "QA-001.pdf");
  expect((await prepareDrawingFiles(file))[0].type).toBe("application/pdf");
  await expect(prepareDrawingFiles(new File(["not a PDF"], "broken.pdf"))).rejects.toThrow("is not a PDF file");
});

test("small valid PDF is passed through without modifying drawing bytes", async () => {
  const document = await PDFDocument.create();
  document.addPage([400, 600]).drawText("QA-001: Two pads 2m x 1.5m x 0.3m = 1.80m3");
  const bytes = await document.save();
  const file = new File([bytes], "QA-001.pdf", { type: "application/pdf" });
  const parts = await prepareDrawingFiles(file);
  expect(parts).toHaveLength(1);
  expect(parts[0]).toBe(file);
  expect(new Uint8Array(await parts[0].arrayBuffer())).toEqual(bytes);
});

test("large PDF preparation preserves every page while removing unused bytes", async () => {
  const document = await PDFDocument.create();
  document.addPage([400, 600]);
  document.addPage([600, 400]);
  const bytes = await document.save();
  const file = new File([bytes, new Uint8Array(21 * 1024 * 1024)], "large.pdf", { type: "application/pdf" });
  const parts = await prepareDrawingFiles(file);
  expect(parts).toHaveLength(1);
  expect(parts[0].size).toBeLessThan(10 * 1024 * 1024);
  const restored = await PDFDocument.load(await parts[0].arrayBuffer());
  expect(restored.getPageCount()).toBe(2);
  expect(restored.getPage(0).getSize()).toEqual({ width: 400, height: 600 });
  expect(restored.getPage(1).getSize()).toEqual({ width: 600, height: 400 });
});
test("valid PDF with a broken body is not misreported as password-protected", async () => {
  const file = new File(["%PDF-1.4\n garbage without objects"], "bad.pdf", { type: "application/pdf" });
  const error = await prepareDrawingFiles(file).then(() => null, (e: Error) => e);
  if (error) expect(error.message).not.toContain("password-protected");
});
