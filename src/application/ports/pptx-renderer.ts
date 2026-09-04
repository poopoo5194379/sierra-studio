import type {
  PptxExportOptions,
  PptxExportResult
} from "../../domain/pptx/export-options";

export interface PptxRenderRequest {
  documentUrl: string;
  outputPath: string;
  options: PptxExportOptions;
}

export interface PptxRenderer {
  render(request: PptxRenderRequest): Promise<PptxExportResult>;
}
