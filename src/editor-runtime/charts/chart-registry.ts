import {
  CHART_MANIFEST_ATTRIBUTE,
  readChartManifest
} from "../../domain/charts/chart-manifest";
import type { ChartPatch } from "../../domain/charts/chart-types";
import type { ChartOverrideManifest } from "../../domain/charts/chart-types";
import {
  isPersistentId,
  pathBetween,
  persistentAnchorOf
} from "../dom";
import { ChartJsAdapter } from "./chartjs-adapter";
import { EChartsAdapter } from "./echarts-adapter";
import { SvgChartAdapter } from "./svg-chart-adapter";
import type {
  ChartAdapter,
  ChartHandle,
  ChartSnapshot
} from "./types";

export class ChartRegistry {
  private readonly echarts = new EChartsAdapter();
  private readonly chartjs = new ChartJsAdapter();
  private readonly svg = new SvgChartAdapter();
  private readonly adapters: ChartAdapter[] = [
    this.echarts,
    this.chartjs,
    this.svg
  ];
  private readonly overrides: ChartOverrideManifest = readChartManifest(document);
  private readonly baselines = new Map<string, ChartPatch>();

  find(target: Element | null): ChartHandle | null {
    if (!target) return null;
    for (const adapter of this.adapters) {
      const handle = adapter.find(target);
      if (handle) return handle;
    }
    return null;
  }

  findByElement(element: HTMLElement): ChartHandle | null {
    for (const adapter of this.adapters) {
      const handle = adapter.findByElement(element);
      if (handle) return handle;
    }
    return null;
  }

  snapshot(handle: ChartHandle): ChartSnapshot {
    return {
      ...handle.snapshot(),
      key: this.keyOf(handle)
    };
  }

  keyOf(handle: ChartHandle): string {
    const element = handle.element;
    const engine = handle.snapshot().engine;
    const editorId = element.getAttribute("data-hs-id");
    // Runtime-only dynamic ids (dyn_*) are not stable across sessions and do
    // not exist in the persisted document; fall through to anchor addressing.
    if (editorId && isPersistentId(editorId)) {
      return `${engine}:node:${editorId}`;
    }
    if (element.id) return `${engine}:id:${element.id}`;
    const anchor = persistentAnchorOf(element.parentElement);
    if (anchor) {
      return `${engine}:anchor:${anchor.getAttribute("data-hs-id")}:${
        pathBetween(anchor, element)
      }`;
    }
    const candidates = this.allHandles().filter(
      (candidate) => candidate.snapshot().engine === engine
    );
    return `${engine}:ordinal:${candidates.findIndex(
      (candidate) => candidate.element === element
    )}`;
  }

  readPatch(handle: ChartHandle): ChartPatch {
    const chartKey = this.keyOf(handle);
    return this.overrides[chartKey] ?? this.baselineOf(chartKey, handle);
  }

  remember(chartKey: string, patch: ChartPatch): void {
    this.overrides[chartKey] = patch;
  }

  applyOverride(chartKey: string, patch: ChartPatch): boolean {
    const handle = this.allHandles().find(
      (candidate) => this.keyOf(candidate) === chartKey
    );
    if (!handle) return false;
    const baseline = this.baselineOf(chartKey, handle);
    if (Object.keys(patch).length === 0) delete this.overrides[chartKey];
    else this.overrides[chartKey] = patch;
    handle.apply({ ...baseline, ...patch });
    handle.resize();
    return true;
  }

  restoreOverrides(): void {
    if (Object.keys(this.overrides).length === 0) return;
    for (const handle of this.allHandles()) {
      const chartKey = this.keyOf(handle);
      const patch = this.overrides[chartKey];
      if (!patch) continue;
      handle.apply({ ...this.baselineOf(chartKey, handle), ...patch });
      handle.resize();
    }
  }

  private baselineOf(chartKey: string, handle: ChartHandle): ChartPatch {
    const existing = this.baselines.get(chartKey);
    if (existing) return existing;
    const snapshot = handle.snapshot();
    const baseline: ChartPatch = {
      title: snapshot.title,
      legendVisible: snapshot.legendVisible,
      primaryColor: snapshot.primaryColor,
      data: snapshot.data
    };
    this.baselines.set(chartKey, baseline);
    return baseline;
  }

  private allHandles(): ChartHandle[] {
    const handles: ChartHandle[] = [];
    const seen = new Set<HTMLElement>();
    for (const element of document.querySelectorAll<HTMLElement>(
      "[_echarts_instance_]"
    )) {
      const handle = this.echarts.findByElement(element);
      if (handle && !seen.has(handle.element)) {
        handles.push(handle);
        seen.add(handle.element);
      }
    }
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>("canvas")) {
      const handle = this.chartjs.findByElement(canvas);
      if (handle && !seen.has(handle.element)) {
        handles.push(handle);
        seen.add(handle.element);
      }
    }
    for (const svg of document.querySelectorAll<SVGSVGElement>("svg")) {
      const handle = this.svg.find(svg);
      if (handle && !seen.has(handle.element)) {
        handles.push(handle);
        seen.add(handle.element);
      }
    }
    return handles;
  }
}

export { CHART_MANIFEST_ATTRIBUTE };
