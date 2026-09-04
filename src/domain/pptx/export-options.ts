import { z } from "zod";

export const PptxExportOptionsSchema = z.object({
  mode: z.enum(["hybrid", "editable", "fidelity"]),
  viewportWidth: z.number().int().min(320).max(3840),
  viewportHeight: z.number().int().min(320).max(2160),
  slideWidth: z.number().min(4).max(20),
  slideHeight: z.number().min(3).max(15)
});

export type PptxExportOptions = z.infer<typeof PptxExportOptionsSchema>;

export interface PptxExportResult {
  outputPath: string;
  mode: PptxExportOptions["mode"];
  slides: number;
  warnings: string[];
}
