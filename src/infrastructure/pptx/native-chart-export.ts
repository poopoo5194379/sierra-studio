import { posix } from "node:path";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";

export type NativeChartKind =
  | "bar"
  | "line"
  | "area"
  | "pie"
  | "doughnut"
  | "radar";

export interface NativeChartSeries {
  name: string;
  type: NativeChartKind;
  labels: string[];
  values: number[];
  color?: string;
  secondaryAxis?: boolean;
}

export interface NativeChartOverlay {
  slideIndex: number;
  engine: "echarts" | "chartjs";
  kind: NativeChartKind | "combo";
  x: number;
  y: number;
  w: number;
  h: number;
  title?: string;
  showLegend: boolean;
  legendPosition: "b" | "l" | "r" | "t" | "tr";
  fontFace: string;
  textColor: string;
  backgroundColor: string;
  gridColor: string;
  chartColors: string[];
  showValues: boolean;
  horizontal: boolean;
  stacked: boolean;
  percentStacked: boolean;
  series: NativeChartSeries[];
}

export interface NativeChartExtraction {
  overlays: NativeChartOverlay[];
  skipped: Array<{
    engine: "echarts" | "chartjs";
    slideIndex: number;
    reason: string;
  }>;
}

function collectNativeChartOverlays(
  slideWidth: number,
  slideHeight: number
): NativeChartExtraction {
  type BrowserRecord = Record<string, unknown>;
  const overlays: NativeChartOverlay[] = [];
  const skipped: NativeChartExtraction["skipped"] = [];
  const seen = new Set<Element>();

  const objectOf = (value: unknown): BrowserRecord =>
    value && typeof value === "object" ? value as BrowserRecord : {};
  const firstObject = (value: unknown): BrowserRecord =>
    Array.isArray(value) ? objectOf(value[0]) : objectOf(value);
  const arrayOf = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
  const firstValue = (value: unknown): unknown =>
    Array.isArray(value) ? value[0] : value;
  const textOf = (value: unknown, fallback = ""): string =>
    typeof value === "string" || typeof value === "number"
      ? String(value)
      : fallback;
  const numberOf = (value: unknown): number | null => {
    const candidate = typeof value === "number" ? value : Number(value);
    return Number.isFinite(candidate) ? candidate : null;
  };
  const dataValue = (value: unknown): number | null => {
    const candidate = objectOf(value);
    const raw = "value" in candidate ? candidate.value : value;
    const scalar = Array.isArray(raw) ? raw[raw.length - 1] : raw;
    return numberOf(scalar);
  };
  const cssColor = (value: unknown, fallback: string): string => {
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.slice(1).toUpperCase();
    if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
      return trimmed.slice(1).split("").map((part) => part + part).join("").toUpperCase();
    }
    const rgb = trimmed.match(/^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
    if (rgb) {
      return rgb.slice(1, 4).map((part) =>
        Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0")
      ).join("").toUpperCase();
    }
    return fallback;
  };
  const hasComplexValue = (value: unknown): boolean => {
    if (typeof value === "function") return true;
    if (Array.isArray(value)) return value.some(hasComplexValue);
    if (!value || typeof value !== "object") return false;
    const record = value as BrowserRecord;
    return "colorStops" in record
      || "image" in record
      || "decal" in record
      || "formatter" in record && typeof record.formatter === "function";
  };
  const legendPosition = (legend: BrowserRecord): NativeChartOverlay["legendPosition"] => {
    if (legend.orient === "vertical" && legend.left === "left") return "l";
    if (legend.orient === "vertical" || legend.right !== undefined) return "r";
    if (legend.top === "top" || legend.top === 0) return "t";
    return "b";
  };
  const chartBounds = (
    element: Element,
    slideIndex: number
  ): Pick<NativeChartOverlay, "slideIndex" | "x" | "y" | "w" | "h"> | null => {
    const roots = Array.from(document.querySelectorAll<HTMLElement>(
      "[data-sierra-pptx-slide]"
    ));
    const root = roots[slideIndex];
    if (!root || !root.contains(element)) return null;
    const rect = element.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20 || rootRect.width < 1 || rootRect.height < 1) {
      return null;
    }
    const scale = Math.min(
      slideWidth / (rootRect.width / 96),
      slideHeight / (rootRect.height / 96)
    );
    return {
      slideIndex,
      x: Math.max(0, (rect.left - rootRect.left) / 96 * scale),
      y: Math.max(0, (rect.top - rootRect.top) / 96 * scale),
      w: Math.min(slideWidth, rect.width / 96 * scale),
      h: Math.min(slideHeight, rect.height / 96 * scale)
    };
  };
  const slideIndexOf = (element: Element): number => {
    const root = element.closest("[data-sierra-pptx-slide]");
    return root ? Number(root.getAttribute("data-sierra-pptx-slide") ?? -1) : -1;
  };
  const addSkipped = (
    engine: "echarts" | "chartjs",
    element: Element,
    reason: string
  ): void => {
    const slideIndex = slideIndexOf(element);
    if (slideIndex >= 0) skipped.push({ engine, slideIndex, reason });
  };
  const baseVisuals = (element: HTMLElement) => {
    const style = getComputedStyle(element);
    const parentStyle = element.parentElement
      ? getComputedStyle(element.parentElement)
      : style;
    const background = style.backgroundColor === "rgba(0, 0, 0, 0)"
      || style.backgroundColor === "transparent"
      ? parentStyle.backgroundColor
      : style.backgroundColor;
    return {
      fontFace: style.fontFamily.split(",")[0]?.replace(/["']/g, "").trim()
        || "Microsoft YaHei",
      textColor: cssColor(style.color, "333333"),
      backgroundColor: cssColor(background, "FFFFFF")
    };
  };

  const roots = Array.from(document.querySelectorAll<HTMLElement>(
    "[data-sierra-pptx-slide]"
  ));
  const echartsGlobal = (window as typeof window & {
    echarts?: { getInstanceByDom(element: HTMLElement): { getOption(): BrowserRecord } | undefined };
  }).echarts;

  roots.forEach((root, slideIndex) => {
    root.querySelectorAll<HTMLElement>("[_echarts_instance_]").forEach((element) => {
      if (seen.has(element)) return;
      const instance = echartsGlobal?.getInstanceByDom(element);
      if (!instance) return;
      seen.add(element);
      const option = instance.getOption();
      const rawSeries = arrayOf(option.series).map(objectOf);
      const rawTypes = rawSeries.map((series) => textOf(series.type, "line"));
      const supportedTypes = new Set(["bar", "line", "pie", "radar"]);
      if (
        rawSeries.length === 0
        || rawTypes.some((type) => !supportedTypes.has(type))
        || rawTypes.includes("pie") && rawTypes.some((type) => type !== "pie")
      ) {
        addSkipped("echarts", element, "图表类型没有稳定的 PowerPoint 原生映射");
        return;
      }

      const title = firstObject(option.title);
      const legend = firstObject(option.legend);
      const xAxis = firstObject(option.xAxis);
      const yAxis = firstObject(option.yAxis);
      const palette = arrayOf(option.color);
      const chartLabels = arrayOf(xAxis.data).map((value) => textOf(value));
      const isPie = rawTypes.every((type) => type === "pie");
      const isRadar = rawTypes.every((type) => type === "radar");
      const isCombo = new Set(rawTypes.map((type, index) =>
        type === "line" && Object.keys(objectOf(rawSeries[index]?.areaStyle)).length > 0
          ? "area"
          : type
      )).size > 1;
      const visualCandidates = [option.backgroundColor, option.graphic];
      rawSeries.forEach((series) => visualCandidates.push(
        series.itemStyle,
        series.lineStyle,
        series.areaStyle,
        series.label
      ));
      const roundedBars = rawSeries.some((series) => {
        const itemStyle = objectOf(series.itemStyle);
        const radius = itemStyle.borderRadius ?? itemStyle.barBorderRadius;
        return Array.isArray(radius)
          ? radius.some((part) => Number(part) > 0)
          : Number(radius ?? 0) > 0;
      });
      if (visualCandidates.some(hasComplexValue) || roundedBars) {
        addSkipped("echarts", element, "包含渐变、图片纹理、脚本样式或圆角柱形，保留视觉快照");
        return;
      }

      const series: NativeChartSeries[] = [];
      for (const [index, item] of rawSeries.entries()) {
        const rawData = arrayOf(item.data);
        let labels = chartLabels;
        if (isPie) {
          labels = rawData.map((entry, dataIndex) =>
            textOf(objectOf(entry).name, String(dataIndex + 1))
          );
        }
        if (isRadar) {
          const radar = firstObject(option.radar);
          labels = arrayOf(radar.indicator).map((entry, dataIndex) =>
            textOf(objectOf(entry).name, String(dataIndex + 1))
          );
        }
        const values = (isRadar && rawData.length === 1
          ? arrayOf(objectOf(rawData[0]).value)
          : rawData).map(dataValue);
        if (values.some((value) => value === null) || labels.length !== values.length) {
          addSkipped("echarts", element, "数据包含对象编码、缺失值或不规则维度");
          return;
        }
        const itemStyle = objectOf(item.itemStyle);
        const lineStyle = objectOf(item.lineStyle);
        const rawColor = itemStyle.color ?? lineStyle.color ?? palette[index];
        if (rawColor !== undefined && typeof rawColor !== "string") {
          addSkipped("echarts", element, "系列颜色不是可映射的纯色");
          return;
        }
        const area = textOf(item.type, "line") === "line"
          && Object.keys(objectOf(item.areaStyle)).length > 0;
        const radius = arrayOf(item.radius);
        series.push({
          name: textOf(item.name, `系列 ${index + 1}`),
          type: textOf(item.type, "line") === "pie"
            ? radius.length > 0 && parseFloat(textOf(radius[0], "0")) > 0
              ? "doughnut"
              : "pie"
            : area
              ? "area"
              : textOf(item.type, "line") as NativeChartKind,
          labels,
          values: values as number[],
          ...(typeof rawColor === "string" ? {
            color: cssColor(rawColor, "5470C6")
          } : {}),
          secondaryAxis: Number(item.yAxisIndex ?? 0) === 1
        });
      }

      const bounds = chartBounds(element, slideIndex);
      if (!bounds) return;
      const visuals = baseVisuals(element);
      const labelsShown = rawSeries.some((seriesItem) =>
        firstObject(seriesItem.label).show === true
      );
      const stacks = rawSeries.map((seriesItem) => textOf(seriesItem.stack));
      const stacked = stacks.some(Boolean) && stacks.every((stack) => stack === stacks[0]);
      const percentStacked = stacked && rawSeries.some((seriesItem) =>
        textOf(seriesItem.stackStrategy).toLowerCase().includes("percent")
      );
      const finalColors = series.map((item, index) =>
        item.color ?? cssColor(
          palette[index],
          ["5470C6", "91CC75", "FAC858", "EE6666"][index % 4] ?? "5470C6"
        )
      );
      overlays.push({
        ...bounds,
        engine: "echarts",
        kind: isCombo ? "combo" : series[0]?.type ?? "line",
        ...(textOf(title.text) ? { title: textOf(title.text) } : {}),
        showLegend: legend.show !== false && series.length > 1 || isPie,
        legendPosition: legendPosition(legend),
        ...visuals,
        gridColor: cssColor(firstObject(yAxis.splitLine).lineStyle
          ? firstObject(firstObject(yAxis.splitLine).lineStyle).color
          : undefined, "D9D9D9"),
        chartColors: finalColors,
        showValues: labelsShown,
        horizontal: textOf(yAxis.type) === "category",
        stacked,
        percentStacked,
        series
      });
    });
  });

  const chartGlobal = (window as typeof window & {
    Chart?: {
      getChart?(canvas: HTMLCanvasElement): BrowserRecord | undefined;
      instances?: BrowserRecord | Map<unknown, BrowserRecord>;
    };
  }).Chart;
  const chartInstances = (): BrowserRecord[] => {
    const instances = chartGlobal?.instances;
    if (instances instanceof Map) return [...instances.values()];
    return Object.values(instances ?? {}).map(objectOf);
  };

  roots.forEach((root, slideIndex) => {
    root.querySelectorAll<HTMLCanvasElement>("canvas").forEach((canvas) => {
      const instance = chartGlobal?.getChart?.(canvas)
        ?? chartInstances().find((candidate) => candidate.canvas === canvas);
      if (!instance || seen.has(canvas)) return;
      seen.add(canvas);
      const config = objectOf(instance.config);
      const data = objectOf(config.data ?? instance.data);
      const options = objectOf(instance.options ?? config.options);
      const datasets = arrayOf(data.datasets).map(objectOf);
      const baseType = textOf(config.type, textOf(instance.type, "line"));
      const types = datasets.map((dataset) => textOf(dataset.type, baseType));
      const supportedTypes = new Set(["bar", "line", "pie", "doughnut", "radar"]);
      if (datasets.length === 0 || types.some((type) => !supportedTypes.has(type))) {
        addSkipped("chartjs", canvas, "图表类型没有稳定的 PowerPoint 原生映射");
        return;
      }
      if (arrayOf(config.plugins).length > 0 || hasComplexValue(config)) {
        addSkipped("chartjs", canvas, "包含内联插件或脚本化样式，保留视觉快照");
        return;
      }
      const isCircular = types.every((type) => type === "pie" || type === "doughnut");
      if (isCircular && new Set(types).size > 1) {
        addSkipped("chartjs", canvas, "混合饼图与环形图无法稳定映射");
        return;
      }
      const labels = arrayOf(data.labels).map((value) => textOf(value));
      const series: NativeChartSeries[] = [];
      for (const [index, dataset] of datasets.entries()) {
        const rawData = arrayOf(dataset.data);
        const values = rawData.map(dataValue);
        if (values.some((value) => value === null) || labels.length !== values.length) {
          addSkipped("chartjs", canvas, "数据包含散点对象、缺失值或不规则维度");
          return;
        }
        const backgroundColor = dataset.backgroundColor;
        const borderColor = dataset.borderColor;
        const perPointColors = Array.isArray(backgroundColor);
        if (
          hasComplexValue(backgroundColor)
          || hasComplexValue(borderColor)
          || perPointColors && !isCircular
          || Number(dataset.borderRadius ?? 0) > 0
        ) {
          addSkipped("chartjs", canvas, "包含渐变、逐点配色或圆角样式，保留视觉快照");
          return;
        }
        const type = types[index] as NativeChartKind;
        const color = typeof backgroundColor === "string"
          ? cssColor(backgroundColor, "36A2EB")
          : typeof borderColor === "string"
            ? cssColor(borderColor, "36A2EB")
            : undefined;
        series.push({
          name: textOf(dataset.label, `系列 ${index + 1}`),
          type,
          labels,
          values: values as number[],
          ...(color ? { color } : {}),
          secondaryAxis: textOf(dataset.yAxisID) === "y1"
        });
      }

      const plugins = objectOf(options.plugins);
      const title = objectOf(plugins.title);
      const legend = objectOf(plugins.legend);
      const legendLabels = objectOf(legend.labels);
      const chartColors = isCircular && Array.isArray(datasets[0]?.backgroundColor)
        ? (datasets[0].backgroundColor as unknown[]).map((color, index) =>
          cssColor(
            color,
            ["36A2EB", "FF6384", "FFCE56", "4BC0C0"][index % 4] ?? "36A2EB"
          )
        )
        : series.map((item, index) =>
          item.color
            ?? ["36A2EB", "FF6384", "FFCE56", "4BC0C0"][index % 4]
            ?? "36A2EB"
        );
      const uniqueTypes = new Set(types);
      const kind = uniqueTypes.size > 1 ? "combo" : types[0] as NativeChartKind;
      const bounds = chartBounds(canvas, slideIndex);
      if (!bounds) return;
      const visuals = baseVisuals(canvas);
      const scales = objectOf(options.scales);
      const yScale = objectOf(scales.y);
      const yGrid = objectOf(yScale.grid);
      overlays.push({
        ...bounds,
        engine: "chartjs",
        kind,
        ...(title.display !== false && textOf(firstValue(title.text))
          ? { title: textOf(firstValue(title.text)) }
          : {}),
        showLegend: legend.display !== false && (series.length > 1 || isCircular),
        legendPosition: ({
          top: "t",
          left: "l",
          right: "r",
          bottom: "b"
        } as Record<string, NativeChartOverlay["legendPosition"]>)[textOf(legend.position, "top")] ?? "t",
        fontFace: textOf(objectOf(legendLabels.font).family, visuals.fontFace),
        textColor: cssColor(legendLabels.color, visuals.textColor),
        backgroundColor: visuals.backgroundColor,
        gridColor: cssColor(yGrid.color, "D9D9D9"),
        chartColors,
        showValues: objectOf(plugins.datalabels).display === true,
        horizontal: textOf(options.indexAxis) === "y",
        stacked: objectOf(scales.x).stacked === true || yScale.stacked === true,
        percentStacked: false,
        series
      });
    });
  });

  return { overlays, skipped };
}

export function nativeChartExtractionScript(
  slideWidth: number,
  slideHeight: number
): string {
  return `(${collectNativeChartOverlays.toString()})(${JSON.stringify(slideWidth)}, ${JSON.stringify(slideHeight)})`;
}

function chartOptions(chart: NativeChartOverlay): Record<string, unknown> {
  const common: Record<string, unknown> = {
    x: chart.x,
    y: chart.y,
    w: chart.w,
    h: chart.h,
    altText: `${chart.title ?? "图表"}（从 ${chart.engine} 转换）`,
    showTitle: Boolean(chart.title),
    title: chart.title,
    titleFontFace: chart.fontFace,
    titleFontSize: 14,
    showLegend: chart.showLegend,
    legendPos: chart.legendPosition,
    legendFontFace: chart.fontFace,
    legendFontSize: 10,
    chartColors: chart.chartColors,
    showValue: chart.showValues,
    showLabel: chart.kind === "pie" || chart.kind === "doughnut",
    showPercent: chart.kind === "pie" || chart.kind === "doughnut"
      ? chart.showValues
      : false,
    catAxisLabelFontFace: chart.fontFace,
    catAxisLabelFontSize: 10,
    catAxisLabelColor: chart.textColor,
    valAxisLabelFontFace: chart.fontFace,
    valAxisLabelFontSize: 10,
    valAxisLabelColor: chart.textColor,
    valGridLine: { color: chart.gridColor, width: 1 },
    chartArea: {
      fill: { color: chart.backgroundColor },
      border: { color: chart.backgroundColor, transparency: 100 },
      roundedCorners: false
    },
    plotArea: {
      fill: { color: chart.backgroundColor },
      border: { color: chart.backgroundColor, transparency: 100 }
    },
    showCatName: chart.kind === "pie" || chart.kind === "doughnut",
    showSerName: false
  };
  if (chart.kind === "bar" || chart.kind === "combo") {
    common.barDir = chart.horizontal ? "bar" : "col";
    if (chart.stacked) {
      common.barGrouping = chart.percentStacked ? "percentStacked" : "stacked";
      common.showValue = chart.showValues;
    }
  }
  return common;
}

function seriesData(series: NativeChartSeries) {
  return [{
    name: series.name,
    labels: series.labels,
    values: series.values
  }];
}

async function buildChartOverlayDeck(
  charts: NativeChartOverlay[],
  slideCount: number,
  slideWidth: number,
  slideHeight: number
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "SIERRA_NATIVE", width: slideWidth, height: slideHeight });
  pptx.layout = "SIERRA_NATIVE";
  pptx.author = "SierraStudio";
  const slides = Array.from({ length: slideCount }, () => pptx.addSlide());
  const chartType = pptx.ChartType as Record<NativeChartKind, unknown>;

  charts.forEach((chart) => {
    const slide = slides[chart.slideIndex];
    if (!slide) return;
    const options = chartOptions(chart);
    if (chart.kind === "combo") {
      const combo = chart.series.map((series) => ({
        type: chartType[series.type],
        data: seriesData(series),
        options: {
          secondaryValAxis: Boolean(series.secondaryAxis),
          secondaryCatAxis: Boolean(series.secondaryAxis),
          ...(series.type === "bar" ? {
            barDir: chart.horizontal ? "bar" : "col",
            ...(chart.stacked ? {
              barGrouping: chart.percentStacked ? "percentStacked" : "stacked"
            } : {})
          } : {})
        }
      }));
      slide.addChart(combo as never, options as never);
      return;
    }
    slide.addChart(
      chartType[chart.kind] as never,
      chart.series.flatMap(seriesData) as never,
      options as never
    );
  });

  const output = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
}

function nextPartIndex(names: string[], expression: RegExp): number {
  return names.reduce((highest, name) => {
    const match = name.match(expression);
    return Math.max(highest, Number(match?.[1] ?? 0));
  }, 0) + 1;
}

function relationshipTargetPath(ownerPath: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  return posix.normalize(posix.join(posix.dirname(ownerPath), target));
}

function appendRelationship(
  xml: string,
  relationship: string
): string {
  return xml.replace("</Relationships>", `${relationship}</Relationships>`);
}

function ensureContentType(
  xml: string,
  entry: string,
  key: string
): string {
  return xml.includes(key) ? xml : xml.replace("</Types>", `${entry}</Types>`);
}

export async function mergeNativeChartsIntoPptx(
  basePptx: Buffer,
  charts: NativeChartOverlay[],
  slideCount: number,
  slideWidth: number,
  slideHeight: number
): Promise<Buffer> {
  if (charts.length === 0) return basePptx;
  const overlayPptx = await buildChartOverlayDeck(
    charts,
    slideCount,
    slideWidth,
    slideHeight
  );
  const [base, overlay] = await Promise.all([
    JSZip.loadAsync(basePptx),
    JSZip.loadAsync(overlayPptx)
  ]);
  let chartIndex = nextPartIndex(Object.keys(base.files), /^ppt\/charts\/chart(\d+)\.xml$/);
  let embeddingIndex = nextPartIndex(
    Object.keys(base.files),
    /^ppt\/embeddings\/Microsoft_Excel_Worksheet(\d+)\.xlsx$/
  );
  let contentTypes = await base.file("[Content_Types].xml")?.async("string") ?? "";
  contentTypes = ensureContentType(
    contentTypes,
    '<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>',
    'Extension="xlsx"'
  );

  for (let slideNumber = 1; slideNumber <= slideCount; slideNumber += 1) {
    const overlaySlidePath = `ppt/slides/slide${slideNumber}.xml`;
    const overlayRelPath = `ppt/slides/_rels/slide${slideNumber}.xml.rels`;
    const baseSlidePath = overlaySlidePath;
    const baseRelPath = overlayRelPath;
    const overlaySlideFile = overlay.file(overlaySlidePath);
    const overlayRelFile = overlay.file(overlayRelPath);
    const baseSlideFile = base.file(baseSlidePath);
    if (!overlaySlideFile || !overlayRelFile || !baseSlideFile) continue;

    const overlaySlideXml = await overlaySlideFile.async("string");
    const overlayRelXml = await overlayRelFile.async("string");
    let baseSlideXml = await baseSlideFile.async("string");
    let baseRelXml = await base.file(baseRelPath)?.async("string")
      ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    let nextRelId = Math.max(
      0,
      ...Array.from(baseRelXml.matchAll(/\bId="rId(\d+)"/g)).map((match) => Number(match[1]))
    ) + 1;
    let nextShapeId = Math.max(
      1,
      ...Array.from(baseSlideXml.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/g)).map((match) => Number(match[1]))
    ) + 1;

    const chartRelationships = Array.from(overlayRelXml.matchAll(
      /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bType="[^"]*\/chart"[^>]*\bTarget="([^"]+)"[^>]*\/>/g
    ));
    for (const relationship of chartRelationships) {
      const oldRelId = relationship[1];
      const oldChartTarget = relationship[2];
      if (!oldRelId || !oldChartTarget) continue;
      const oldChartPath = relationshipTargetPath(overlaySlidePath, oldChartTarget);
      const oldChartFile = overlay.file(oldChartPath);
      if (!oldChartFile) continue;
      const newChartPath = `ppt/charts/chart${chartIndex}.xml`;
      base.file(newChartPath, await oldChartFile.async("uint8array"));

      const oldChartRelPath = posix.join(
        posix.dirname(oldChartPath),
        "_rels",
        `${posix.basename(oldChartPath)}.rels`
      );
      const oldChartRelFile = overlay.file(oldChartRelPath);
      if (oldChartRelFile) {
        let chartRelXml = await oldChartRelFile.async("string");
        const packageRelationships = Array.from(chartRelXml.matchAll(
          /<Relationship\b[^>]*\bType="[^"]*\/package"[^>]*\bTarget="([^"]+)"[^>]*\/>/g
        ));
        for (const packageRelationship of packageRelationships) {
          const oldTarget = packageRelationship[1];
          if (!oldTarget) continue;
          const oldEmbeddingPath = relationshipTargetPath(oldChartPath, oldTarget);
          const oldEmbeddingFile = overlay.file(oldEmbeddingPath);
          if (!oldEmbeddingFile) continue;
          const newEmbeddingName = `Microsoft_Excel_Worksheet${embeddingIndex}.xlsx`;
          const newEmbeddingPath = `ppt/embeddings/${newEmbeddingName}`;
          base.file(newEmbeddingPath, await oldEmbeddingFile.async("uint8array"));
          chartRelXml = chartRelXml.replace(oldTarget, `../embeddings/${newEmbeddingName}`);
          embeddingIndex += 1;
        }
        const newChartRelPath = `ppt/charts/_rels/chart${chartIndex}.xml.rels`;
        base.file(newChartRelPath, chartRelXml);
      }

      contentTypes = ensureContentType(
        contentTypes,
        `<Override PartName="/${newChartPath}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
        `PartName="/${newChartPath}"`
      );
      const newRelId = `rId${nextRelId}`;
      nextRelId += 1;
      baseRelXml = appendRelationship(
        baseRelXml,
        `<Relationship Id="${newRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartIndex}.xml"/>`
      );

      const frame = Array.from(overlaySlideXml.matchAll(
        /<p:graphicFrame\b[\s\S]*?<c:chart\b[^>]*\br:id="([^"]+)"[\s\S]*?<\/p:graphicFrame>/g
      )).find((candidate) => candidate[1] === oldRelId)?.[0];
      if (frame) {
        const updatedFrame = frame
          .replace(`r:id="${oldRelId}"`, `r:id="${newRelId}"`)
          .replace(/(<p:cNvPr\b[^>]*\bid=")\d+("[^>]*\bname=")[^"]*(")/,
            `$1${nextShapeId}$2原生图表 ${nextShapeId}$3`);
        nextShapeId += 1;
        baseSlideXml = baseSlideXml.replace("</p:spTree>", `${updatedFrame}</p:spTree>`);
      }
      chartIndex += 1;
    }
    base.file(baseSlidePath, baseSlideXml);
    base.file(baseRelPath, baseRelXml);
  }

  base.file("[Content_Types].xml", contentTypes);
  return base.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
}
