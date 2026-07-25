import {
  PDFDocument,
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle
} from "pdf-lib";

export async function pdfPageCount(buffer: Uint8Array): Promise<number> {
  return (await PDFDocument.load(buffer)).getPageCount();
}

export async function mergeFirstPdfPages(
  buffers: Uint8Array[]
): Promise<Buffer> {
  const outputPdf = await PDFDocument.create();
  for (const [index, buffer] of buffers.entries()) {
    const sourcePdf = await PDFDocument.load(buffer);
    if (sourcePdf.getPageCount() < 1) {
      throw new Error(`PDF segment ${index + 1} has no pages`);
    }
    const [page] = await outputPdf.copyPages(sourcePdf, [0]);
    outputPdf.addPage(page);
  }
  const output = await outputPdf.save();
  if (outputPdf.getPageCount() !== buffers.length) {
    throw new Error("Segmented PDF page count verification failed");
  }
  return Buffer.from(output);
}

export async function composePngPdfPages(
  pages: Array<{
    png: Uint8Array;
    widthPx: number;
    heightPx: number;
  }>
): Promise<Buffer> {
  const outputPdf = await PDFDocument.create();
  for (const [index, source] of pages.entries()) {
    if (source.widthPx <= 0 || source.heightPx <= 0) {
      throw new Error(`Raster PDF page ${index + 1} has invalid dimensions`);
    }
    const image = await outputPdf.embedPng(source.png);
    const width = source.widthPx * 0.75;
    const height = source.heightPx * 0.75;
    const page = outputPdf.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
  }
  return Buffer.from(await outputPdf.save());
}

export async function composeSmartPdf(
  longPdf: Uint8Array,
  documentHeightPx: number,
  cuts: number[]
): Promise<Buffer> {
  const sourcePdf = await PDFDocument.load(longPdf);
  if (sourcePdf.getPageCount() !== 1) {
    throw new Error("Smart pagination requires a one-page vector PDF source");
  }
  const sourcePage = sourcePdf.getPage(0);
  const sourceWidth = sourcePage.getWidth();
  const sourceHeight = sourcePage.getHeight();
  const yScale = sourceHeight / documentHeightPx;
  const outputPdf = await PDFDocument.create();
  const embedded = await outputPdf.embedPage(sourcePage);

  for (let index = 0; index < cuts.length - 1; index += 1) {
    const topPx = cuts[index]!;
    const bottomPx = cuts[index + 1]!;
    const segmentPx = bottomPx - topPx;
    if (segmentPx <= 1) continue;
    const segmentHeight = segmentPx * yScale;
    const outputPage = outputPdf.addPage([sourceWidth, segmentHeight]);
    outputPage.pushOperators(
      pushGraphicsState(),
      rectangle(0, 0, sourceWidth, segmentHeight),
      clip(),
      endPath()
    );
    outputPage.drawPage(embedded, {
      x: 0,
      y: segmentHeight - sourceHeight + topPx * yScale,
      width: sourceWidth,
      height: sourceHeight
    });
    outputPage.pushOperators(popGraphicsState());
  }

  const output = await outputPdf.save();
  const verification = await PDFDocument.load(output);
  if (verification.getPageCount() !== cuts.length - 1) {
    throw new Error("Smart PDF page count verification failed");
  }
  for (const [index, page] of verification.getPages().entries()) {
    if (page.getWidth() <= 0 || page.getHeight() <= 0) {
      throw new Error(`Smart PDF page ${index + 1} has invalid dimensions`);
    }
  }
  return Buffer.from(output);
}
