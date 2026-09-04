import { z } from "zod";

export const ChartDataSchema = z.object({
  labels: z.array(z.union([z.string(), z.number()])).optional(),
  series: z.array(z.object({
    name: z.string().optional(),
    type: z.string().optional(),
    color: z.string().optional(),
    data: z.array(z.unknown())
  }))
});

export type ChartData = z.infer<typeof ChartDataSchema>;

export const ChartPatchSchema = z.object({
  title: z.string().optional(),
  legendVisible: z.boolean().optional(),
  primaryColor: z.string().optional(),
  data: ChartDataSchema.optional()
});

export type ChartPatch = z.infer<typeof ChartPatchSchema>;

export type ChartOverrideManifest = Record<string, ChartPatch>;
