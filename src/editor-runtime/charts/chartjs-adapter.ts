import type {
  ChartAdapter,
  ChartHandle,
  ChartPatch,
  ChartSnapshot
} from "./types";

interface ChartJsInstance {
  canvas: HTMLCanvasElement;
  config: {
    data?: {
      datasets?: Array<Record<string, unknown>>;
    };
    options?: Record<string, unknown>;
  };
  options: Record<string, unknown>;
  update(mode?: string): void;
  resize(): void;
}

interface ChartJsGlobal {
  getChart?(canvas: HTMLCanvasElement): ChartJsInstance | undefined;
  instances?: Record<string, ChartJsInstance> | Map<unknown, ChartJsInstance>;
}

function globalChart(): ChartJsGlobal | undefined {
  return (window as typeof window & { Chart?: ChartJsGlobal }).Chart;
}

function instanceFor(canvas: HTMLCanvasElement): ChartJsInstance | undefined {
  const chart = globalChart();
  const direct = chart?.getChart?.(canvas);
  if (direct) return direct;
  const instances = chart?.instances;
  const values = instances instanceof Map
    ? [...instances.values()]
    : Object.values(instances ?? {});
  return values.find((instance) => instance.canvas === canvas);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

class ChartJsHandle implements ChartHandle {
  readonly element: HTMLElement;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly instance: ChartJsInstance
  ) {
    this.element = canvas;
  }

  snapshot(): Omit<ChartSnapshot, "key"> {
    const plugins = record(this.instance.options.plugins);
    const title = record(plugins.title);
    const legend = record(plugins.legend);
    const firstDataset = this.instance.config.data?.datasets?.[0] ?? {};
    const color = firstDataset.backgroundColor;
    const configuredData = this.instance.config.data as {
      labels?: unknown[];
      datasets?: Array<Record<string, unknown>>;
    } | undefined;
    return {
      engine: "chartjs",
      editable: true,
      title: typeof title.text === "string" ? title.text : "",
      legendVisible: legend.display !== false,
      primaryColor: typeof color === "string" ? color : "#36a2eb",
      data: {
        ...(Array.isArray(configuredData?.labels) ? {
          labels: configuredData.labels.filter(
            (value): value is string | number =>
              typeof value === "string" || typeof value === "number"
          )
        } : {}),
        series: (configuredData?.datasets ?? []).map((dataset) => ({
          ...(typeof dataset.label === "string" ? { name: dataset.label } : {}),
          data: Array.isArray(dataset.data) ? dataset.data : []
        }))
      }
    };
  }

  apply(patch: ChartPatch): void {
    const plugins = record(this.instance.options.plugins);
    this.instance.options.plugins = plugins;
    if (patch.title !== undefined) {
      const title = record(plugins.title);
      title.display = patch.title.length > 0;
      title.text = patch.title;
      plugins.title = title;
    }
    if (patch.legendVisible !== undefined) {
      const legend = record(plugins.legend);
      legend.display = patch.legendVisible;
      plugins.legend = legend;
    }
    if (patch.primaryColor !== undefined) {
      const datasets = this.instance.config.data?.datasets;
      if (datasets?.[0]) {
        datasets[0].backgroundColor = patch.primaryColor;
        datasets[0].borderColor = patch.primaryColor;
      }
    }
    if (patch.data !== undefined && this.instance.config.data) {
      const data = this.instance.config.data as {
        labels?: Array<string | number>;
        datasets?: Array<Record<string, unknown>>;
      };
      if (patch.data.labels) data.labels = patch.data.labels;
      data.datasets = patch.data.series.map((series, index) => ({
        ...(data.datasets?.[index] ?? {}),
        ...(series.name !== undefined ? { label: series.name } : {}),
        data: series.data
      }));
    }
    this.instance.update("none");
  }

  resize(): void {
    this.instance.resize();
  }
}

export class ChartJsAdapter implements ChartAdapter {
  find(target: Element): ChartHandle | null {
    const canvas = target instanceof HTMLCanvasElement
      ? target
      : target.closest<HTMLCanvasElement>("canvas");
    return canvas ? this.findCanvas(canvas) : null;
  }

  findByElement(element: HTMLElement): ChartHandle | null {
    return element instanceof HTMLCanvasElement
      ? this.findCanvas(element)
      : null;
  }

  private findCanvas(canvas: HTMLCanvasElement): ChartHandle | null {
    const instance = instanceFor(canvas);
    return instance ? new ChartJsHandle(canvas, instance) : null;
  }
}
