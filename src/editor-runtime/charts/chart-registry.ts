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
import type {
  ChartAdapter,
  ChartHandle,
  ChartSnapshot
} from "./types";

export class ChartRegistry {
  private readonly echarts = new EChartsAdapter();
  private readonly chartjs = new ChartJsAdapter();
  private readonly adapters: ChartAdapter[] = [this.echarts, this.chartjs];
  private readonly overrides: ChartOverrideManifest = readChartManifest(document);

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
    return this.overrides[this.keyOf(handle)] ?? {};
  }

  remember(chartKey: string, patch: ChartPatch): void {
    this.overrides[chartKey] = patch;
  }

  restoreOverrides(): void {
    if (Object.keys(this.overrides).length === 0) return;
    for (const handle of this.allHandles()) {
      const patch = this.overrides[this.keyOf(handle)];
      if (!patch) continue;
      handle.apply(patch);
      handle.resize();
    }
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
    return handles;
  }
}

export { CHART_MANIFEST_ATTRIBUTE };
