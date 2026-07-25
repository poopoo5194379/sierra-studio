import type {
  ChartAdapter,
  ChartHandle,
  ChartPatch,
  ChartSnapshot
} from "./types";

interface EChartsInstance {
  getOption(): Record<string, unknown>;
  setOption(option: Record<string, unknown>, notMerge?: boolean): void;
  resize(): void;
}

interface EChartsGlobal {
  getInstanceByDom(element: HTMLElement): EChartsInstance | undefined;
}

function globalECharts(): EChartsGlobal | undefined {
  return (window as typeof window & { echarts?: EChartsGlobal }).echarts;
}

function firstObject(value: unknown): Record<string, unknown> {
  if (Array.isArray(value) && value[0] && typeof value[0] === "object") {
    return value[0] as Record<string, unknown>;
  }
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.find((item): item is string => typeof item === "string");
  }
  return undefined;
}

class EChartsHandle implements ChartHandle {
  constructor(
    readonly element: HTMLElement,
    private readonly instance: EChartsInstance
  ) {}

  snapshot(): Omit<ChartSnapshot, "key"> {
    const option = this.instance.getOption();
    const title = firstObject(option.title);
    const legend = firstObject(option.legend);
    const xAxis = firstObject(option.xAxis);
    const series = Array.isArray(option.series)
      ? option.series.map((value) => {
        const item = firstObject(value);
        return {
          ...(typeof item.name === "string" ? { name: item.name } : {}),
          ...(typeof item.type === "string" ? { type: item.type } : {}),
          data: Array.isArray(item.data) ? item.data : []
        };
      })
      : [];
    return {
      engine: "echarts",
      editable: true,
      title: typeof title.text === "string" ? title.text : "",
      legendVisible: legend.show !== false,
      primaryColor: firstString(option.color) ?? "#5470c6",
      data: {
        ...(Array.isArray(xAxis.data) ? { labels: xAxis.data.filter(
          (value): value is string | number =>
            typeof value === "string" || typeof value === "number"
        ) } : {}),
        series
      }
    };
  }

  apply(patch: ChartPatch): void {
    const option: Record<string, unknown> = {};
    if (patch.title !== undefined) option.title = { text: patch.title };
    if (patch.legendVisible !== undefined) {
      option.legend = { show: patch.legendVisible };
    }
    if (patch.primaryColor !== undefined) {
      const current = this.instance.getOption();
      const palette = Array.isArray(current.color)
        ? [...current.color]
        : [];
      palette[0] = patch.primaryColor;
      option.color = palette;
    }
    if (patch.data !== undefined) {
      if (patch.data.labels) option.xAxis = { data: patch.data.labels };
      option.series = patch.data.series.map((series) => ({
        ...(series.name !== undefined ? { name: series.name } : {}),
        ...(series.type !== undefined ? { type: series.type } : {}),
        data: series.data
      }));
    }
    if (Object.keys(option).length > 0) this.instance.setOption(option, false);
  }

  resize(): void {
    this.instance.resize();
  }
}

export class EChartsAdapter implements ChartAdapter {
  find(target: Element): ChartHandle | null {
    let current: HTMLElement | null = target instanceof HTMLElement
      ? target
      : target.parentElement;
    while (current && current !== document.body) {
      const handle = this.findByElement(current);
      if (handle) return handle;
      current = current.parentElement;
    }
    return null;
  }

  findByElement(element: HTMLElement): ChartHandle | null {
    const instance = globalECharts()?.getInstanceByDom(element);
    return instance ? new EChartsHandle(element, instance) : null;
  }
}
