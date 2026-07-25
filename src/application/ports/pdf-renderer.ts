import type {
  PdfExportOptions,
  PdfExportResult
} from "../../domain/pdf/export-options";

export interface PdfRenderRequest {
  documentUrl: string;
  outputPath: string;
  options: PdfExportOptions;
}

export interface PdfRenderer {
  render(request: PdfRenderRequest): Promise<PdfExportResult>;
}
