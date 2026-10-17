// Server-only: turns a PDF into positioned text items for the statement
// parser. Uses the pdf.js legacy build, which runs in Node without a worker.
import type { PdfTextItem } from "./resalat-statement";

export const MAX_STATEMENT_PDF_BYTES = 5 * 1024 * 1024;

export async function extractPdfItems(data: Uint8Array): Promise<PdfTextItem[][]> {
  // pdf.js runs its worker in-process on the server. Loading the worker
  // module here (instead of letting pdf.js import it by a computed path)
  // keeps it in the deployed bundle.
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const scope = globalThis as { pdfjsWorker?: unknown };
  scope.pdfjsWorker ??= worker;
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const document = await loadingTask.promise;

  try {
    const pages: PdfTextItem[][] = [];
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 60); pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      // The statement is a rotated page; viewport coordinates undo the rotation.
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        items.push({ str: item.str, x, y, w: item.width, dir: item.dir });
      }
      pages.push(items);
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}
