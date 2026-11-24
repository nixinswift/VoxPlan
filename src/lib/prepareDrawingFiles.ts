import { PDFDocument } from "pdf-lib";

const ANALYSIS_PART_BYTES = 10 * 1024 * 1024;

export function normalizeDrawingFile(file: File): File {
  const fallback = !file.type || file.type === "application/octet-stream";
  const ext = file.name.split(".").pop()?.toLowerCase();
  const mime = ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" } as Record<string, string>)[ext ?? ""];
  return fallback && mime ? new File([file], file.name, { type: mime, lastModified: file.lastModified }) : file;
}

/** Rewrites large PDFs to remove unused data, then groups pages without rasterizing engineering callouts. */
export async function prepareDrawingFiles(file: File): Promise<File[]> {
  file = normalizeDrawingFile(file);
  if (file.type !== "application/pdf") return [file];
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await file.arrayBuffer()); }
  catch (error) {
    throw new Error(`Your device could not read "${file.name}" (${describeError(error)}). If it is stored in iCloud or another cloud folder, download it to the device first, then retry.`);
  }
  if (!hasPdfHeader(bytes)) {
    throw new Error(`"${file.name}" is not a PDF file (no PDF header found). The browser delivered ${bytes.length.toLocaleString()} of ${file.size.toLocaleString()} bytes, starting "${previewBytes(bytes)}". If this does not match the original file, the file was altered during transfer; re-select it from local storage.`);
  }
  let source: PDFDocument;
  try { source = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false }); }
  catch (error) {
    if (isEncryptedError(error)) throw new Error(`"${file.name}" is password-protected. Upload an unlocked copy.`);
    throw new Error(`VoxPlan could not prepare "${file.name}" for analysis (${describeError(error)}). The file was not changed; please report this message.`);
  }
  if (!source.getPageCount()) throw new Error("This PDF contains no drawing pages.");
  if (file.size <= ANALYSIS_PART_BYTES) return [file];
  const makePart = async (indices: number[], suffix: string) => {
    const part = await PDFDocument.create();
    const pages = await part.copyPages(source, indices);
    pages.forEach((page) => part.addPage(page));
    const bytes = await part.save();
    return new File([new Uint8Array(bytes)], `${file.name.replace(/\.pdf$/i, "")}${suffix}.pdf`, { type: "application/pdf" });
  };
  const indices = source.getPageIndices();
  const compact = await makePart(indices, "");
  if (compact.size <= ANALYSIS_PART_BYTES) return [compact];
  const split = async (pages: number[]): Promise<File[]> => {
    const part = await makePart(pages, `-pages-${(pages[0] ?? 0) + 1}-${(pages[pages.length - 1] ?? 0) + 1}`);
    if (part.size <= ANALYSIS_PART_BYTES) return [part];
    if (pages.length <= 1) throw new Error("One drawing page is too large to analyze. Export that page as an optimized PDF and retry.");
    const middle = Math.ceil(pages.length / 2);
    return [...await split(pages.slice(0, middle)), ...await split(pages.slice(middle))];
  };
  return split(indices);
}
function hasPdfHeader(bytes: Uint8Array): boolean {
  return new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF-");
}

function isEncryptedError(error: unknown): boolean {
  const name = (error as { constructor?: { name?: string } })?.constructor?.name ?? "";
  return /Encrypted/i.test(name) || /encrypted/i.test(String((error as Error)?.message ?? ""));
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 160) || "unknown error";
}

function previewBytes(bytes: Uint8Array): string {
  return Array.from(bytes.subarray(0, 16), (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, "0")}`)).join("");
}
