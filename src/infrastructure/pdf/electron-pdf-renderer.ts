import { BrowserWindow } from "electron";
import type {
  PdfExportResult
} from "../../domain/pdf/export-options";
import { planSmartCuts } from "../../domain/pdf/smart-pagination";
import type {
  PdfRenderRequest,
  PdfRenderer
} from "../../application/ports/pdf-renderer";
import { atomicWriteFile } from "../filesystem/atomic-files";
import {
  alignParallelSmartBlocks,
  collectPaginationHints,
  measureDocument,
  stabilizeForPdf
} from "./browser-document-analyzer";
import {
  composePngPdfPages,
  composeSmartPdf,
  pdfPageCount
} from "./pdf-composer";

const INCHES_PER_CSS_PIXEL = 1 / 96;

export class ElectronPdfRenderer implements PdfRenderer {
  async render(request: PdfRenderRequest): Promise<PdfExportResult> {
    const { options } = request;
    const window = new BrowserWindow({
      show: false,
      width: options.viewportWidth,
      height: options.viewportHeight,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    });

    try {
      await window.loadURL(request.documentUrl);
      let frozenViewportProperties: number;
      try {
        frozenViewportProperties = await stabilizeForPdf(window.webContents);
      } catch (error) {
        throw new Error(
          `PDF stabilization failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      if (options.mode === "smart") {
        try {
          await alignParallelSmartBlocks(
            window.webContents,
            options.targetPageHeight
          );
        } catch (error) {
          throw new Error(
            `PDF block alignment failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
      const measurement = await measureDocument(
        window.webContents,
        frozenViewportProperties
      );
      if (measurement.width <= 0 || measurement.height <= 0) {
        throw new Error(
          `Invalid document dimensions: ${measurement.width} x ${measurement.height}`
        );
      }

      let output: Buffer;
      let pages = 1;
      let warnings: string[] = [];
      if (options.mode === "smart") {
        const hints = await collectPaginationHints(
          window.webContents,
          options.targetPageHeight
        );
        const plan = planSmartCuts(
          measurement.height,
          hints,
          options.targetPageHeight
        );
        if (measurement.height > 14_000) {
          output = await this.captureSegments(
            window,
            measurement.width,
            plan.cuts
          );
          warnings.push(
            "The document exceeded Chromium's safe vector height; smart pages were rasterized for layout fidelity."
          );
        } else {
          const longPdf = await this.printOnePage(
            window,
            measurement.width,
            measurement.height
          );
          output = await composeSmartPdf(
            longPdf,
            measurement.height + 2,
            plan.cuts
          );
        }
        pages = plan.cuts.length - 1;
        warnings = plan.warnings;
      } else {
        output = await this.printOnePage(
          window,
          measurement.width,
          measurement.height
        );
      }
      if (measurement.failedImages > 0) {
        warnings.push(
          `${measurement.failedImages} image(s) failed to load; review the PDF.`
        );
      }
      await atomicWriteFile(request.outputPath, output);
      return {
        outputPath: request.outputPath,
        mode: options.mode,
        pages,
        documentWidth: measurement.width,
        documentHeight: measurement.height,
        failedImages: measurement.failedImages,
        warnings
      };
    } finally {
      if (!window.isDestroyed()) window.destroy();
    }
  }

  private async printOnePage(
    window: BrowserWindow,
    widthPx: number,
    heightPx: number
  ): Promise<Buffer> {
    let extraHeight = 2;
    let lastPageCount = 0;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const buffer = await window.webContents.printToPDF({
        pageSize: {
          width: (widthPx + 2) * INCHES_PER_CSS_PIXEL,
          height: (heightPx + extraHeight) * INCHES_PER_CSS_PIXEL
        },
        margins: {
          marginType: "none"
        },
        printBackground: true,
        preferCSSPageSize: false,
        displayHeaderFooter: false,
        landscape: false,
        scale: 1
      });
      lastPageCount = await pdfPageCount(buffer);
      if (lastPageCount === 1) return buffer;
      extraHeight += Math.max(256, Math.ceil(heightPx * 0.025));
    }
    throw new Error(
      `The document remained ${lastPageCount} pages after long-page retries.`
    );
  }

  private async captureSegments(
    window: BrowserWindow,
    widthPx: number,
    cuts: number[]
  ): Promise<Buffer> {
    const segments: Array<{
      png: Buffer;
      widthPx: number;
      heightPx: number;
    }> = [];
    for (let index = 0; index < cuts.length - 1; index += 1) {
      const top = cuts[index]!;
      const bottom = cuts[index + 1]!;
      const height = bottom - top;
      if (height <= 1) continue;
      const scrollOffset = await window.webContents.executeJavaScript(`(async function () {
        for (const hidden of window.__hsPdfHiddenBranches || []) {
          if (hidden.value) {
            hidden.element.style.setProperty(
              "visibility",
              hidden.value,
              hidden.priority
            );
          } else {
            hidden.element.style.removeProperty("visibility");
          }
        }
        window.__hsPdfHiddenBranches = [];
        window.scrollTo(0, ${top});
        const isolate = (element) => {
          const rect = element.getBoundingClientRect();
          const branchTop = rect.top + window.scrollY;
          const branchBottom = rect.bottom + window.scrollY;
          const hasArea = rect.width > 0 && rect.height > 0;
          const outside =
            branchBottom <= ${top} + 1 || branchTop >= ${bottom} - 1;
          if (hasArea && outside) {
            window.__hsPdfHiddenBranches.push({
              element,
              value: element.style.getPropertyValue("visibility"),
              priority: element.style.getPropertyPriority("visibility")
            });
            element.style.setProperty("visibility", "hidden", "important");
            return;
          }
          for (const child of element.children) isolate(child);
        };
        for (const child of document.body.children) isolate(child);
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
        return { y: window.scrollY };
      })()`, true);
      const image = await window.webContents.capturePage({
        x: 0,
        y: Math.max(0, Math.round(top - scrollOffset.y)),
        width: Math.ceil(widthPx),
        height: Math.ceil(height)
      });
      segments.push({
        png: image.toPNG(),
        widthPx,
        heightPx: height
      });
    }
    window.webContents.executeJavaScript("window.scrollTo(0, 0)", true)
      .catch(() => undefined);
    return composePngPdfPages(segments);
  }
}
