export type ChartEngine = "echarts" | "chartjs";

import type { ChartPatch } from "../../domain/charts/chart-types";

export type { ChartPatch } from "../../domain/charts/chart-types";

export interface ChartSnapshot extends ChartPatch {
  engine: ChartEngine;
  editable: true;
  key: string;
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
