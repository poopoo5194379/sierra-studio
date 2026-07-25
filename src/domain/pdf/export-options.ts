import { z } from "zod";

export const PdfExportOptionsSchema = z.object({
  mode: z.enum(["long", "smart"]),
  viewportWidth: z.number().int().min(320).max(3840),
  viewportHeight: z.number().int().min(320).max(2160),
  targetPageHeight: z.number().int().min(320).max(4000)
});

export type PdfExportOptions = z.infer<typeof PdfExportOptionsSchema>;

export interface PdfExportResult {
  outputPath: string;
  mode: PdfExportOptions["mode"];
  pages: number;
  documentWidth: number;
  documentHeight: number;
  failedImages: number;
  warnings: string[];
}
