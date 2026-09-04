export type ChartEngine = "echarts" | "chartjs" | "svg";

import type { ChartPatch } from "../../domain/charts/chart-types";

export type { ChartPatch } from "../../domain/charts/chart-types";

export interface ChartStyleProfile {
  palette: string[];
  fontFamily?: string;
  textColor?: string;
  mutedColor?: string;
  gridColor?: string;
  borderColor?: string;
  borderWidth?: number;
  itemOpacity?: number;
  pieInnerRatio?: number;
  pieCenterText?: string;
  pieCenterSubtext?: string;
  pieCenterColor?: string;
  pieCenterSubtextColor?: string;
  areaOpacity?: number;
  lineWidth?: number;
  symbolSize?: number;
  barOrientation?: "horizontal" | "vertical";
  barRadius?: number;
  barOpacity?: number;
  categoryColors?: string[];
  categoryLabelColors?: string[];
  showValues?: boolean;
  valueSuffix?: string;
}

export interface ChartSnapshot extends ChartPatch {
  engine: ChartEngine;
  editable: boolean;
  key: string;
  conversion?: {
    supported: boolean;
    confidence: "high" | "medium" | "low";
    suggestedType?: "line" | "bar" | "area" | "pie";
    reason: string;
    style?: ChartStyleProfile;
  };
}

export interface ChartHandle {
  element: HTMLElement;
  snapshot(): Omit<ChartSnapshot, "key">;
  apply(patch: ChartPatch): void;
  resize(): void;
}

export interface ChartAdapter {
  find(target: Element): ChartHandle | null;
  findByElement(element: HTMLElement): ChartHandle | null;
}
