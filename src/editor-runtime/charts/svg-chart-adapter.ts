import type { ChartData, ChartPatch } from "../../domain/charts/chart-types";
import { isPersistentId } from "../dom";
import type {
  ChartAdapter,
  ChartHandle,
  ChartSnapshot,
  ChartStyleProfile
} from "./types";

type SuggestedType = "line" | "bar" | "area" | "pie";

interface RecoveredChart {
  data?: ChartData;
  primaryColor?: string;
  suggestedType?: SuggestedType;
  confidence: "high" | "medium" | "low";
  reason: string;
  style?: ChartStyleProfile;
}

function numericAttribute(element: Element, name: string): number | undefined {
  const value = Number.parseFloat(element.getAttribute(name) ?? "");
  return Number.isFinite(value) ? value : undefined;
}

function commonAttribute(
  elements: Element[],
  name: string
): string | undefined {
  const counts = new Map<string, number>();
  for (const element of elements) {
    const value = element.getAttribute(name);
    if (!value || value === "none" || value === "transparent") continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function baseStyle(svg: SVGSVGElement): ChartStyleProfile {
  const text = [...svg.querySelectorAll("text")];
  const dashedLines = [...svg.querySelectorAll("line[stroke-dasharray]")];
  const computed = getComputedStyle(svg.parentElement ?? svg);
  const mutedColor = commonAttribute(text, "fill");
  const gridColor = commonAttribute(dashedLines, "stroke");
  return {
    palette: [],
    ...(computed.fontFamily ? { fontFamily: computed.fontFamily } : {}),
    ...(computed.color ? { textColor: computed.color } : {}),
    ...(mutedColor ? { mutedColor } : {}),
    ...(gridColor ? { gridColor } : {})
  };
}

function persistentContainer(svg: SVGSVGElement): HTMLElement | null {
  let current = svg.parentElement;
  while (current && current !== document.body) {
    const editorId = current.getAttribute("data-hs-id");
    if (editorId && isPersistentId(editorId)) return current;
    current = current.parentElement;
  }
  return null;
}

function titleText(element: Element): string {
  return element.querySelector(":scope > title")?.textContent?.trim() ?? "";
}

function parseNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface SvgRectGeometry {
  element: SVGRectElement;
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
}

interface SvgTextGeometry {
  element: SVGTextElement;
  x: number;
  y: number;
  text: string;
}

function rectGeometry(svg: SVGSVGElement): SvgRectGeometry[] {
  return [...svg.querySelectorAll<SVGRectElement>("rect")].flatMap((element) => {
    const x = numericAttribute(element, "x");
    const y = numericAttribute(element, "y");
    const width = numericAttribute(element, "width");
    const height = numericAttribute(element, "height");
    if (
      x === undefined || y === undefined
      || width === undefined || height === undefined
    ) return [];
    const fill = element.getAttribute("fill");
    return [{
      element,
      x,
      y,
      width,
      height,
      ...(fill ? { fill } : {})
    }];
  });
}

function textGeometry(svg: SVGSVGElement): SvgTextGeometry[] {
  return [...svg.querySelectorAll<SVGTextElement>("text")].flatMap((element) => {
    const x = numericAttribute(element, "x");
    const y = numericAttribute(element, "y");
    const value = element.textContent?.trim();
    if (x === undefined || y === undefined || !value) return [];
    return [{ element, x, y, text: value }];
  });
}

function visibleNumber(text: string): {
  value: number;
  suffix: string;
} | null {
  const normalized = text.replace(/,/g, "").trim();
  const match = normalized.match(
    /^[-+]?(\d+(?:\.\d+)?|\.\d+)\s*(%|×|x|倍)?$/i
  );
  if (!match) return null;
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) return null;
  return { value, suffix: match[2] ?? "" };
}

function roundedGroup(value: number, tolerance = 4): number {
  return Math.round(value / tolerance) * tolerance;
}

function mostFrequentGroup<T>(
  items: T[],
  key: (item: T) => number
): T[] {
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const groupKey = key(item);
    const group = groups.get(groupKey) ?? [];
    group.push(item);
    groups.set(groupKey, group);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
}

function legendNamesByColor(
  rects: SvgRectGeometry[],
  texts: SvgTextGeometry[],
  dataRects: Set<SVGRectElement>
): Map<string, string> {
  const result = new Map<string, string>();
  for (const rect of rects) {
    if (
      dataRects.has(rect.element)
      || !rect.fill
      || rect.width > 24
      || rect.height > 24
    ) continue;
    const label = texts
      .filter((text) =>
        text.x >= rect.x + rect.width
        && text.x <= rect.x + rect.width + 180
        && Math.abs(text.y - (rect.y + rect.height * 0.75)) <= 12
      )
      .sort((a, b) => a.x - b.x)[0];
    if (label && !visibleNumber(label.text)) result.set(rect.fill, label.text);
  }
  return result;
}

function recoverHorizontalBars(
  svg: SVGSVGElement,
  rects: SvgRectGeometry[],
  texts: SvgTextGeometry[]
): RecoveredChart | null {
  const candidates = rects.filter((rect) =>
    rect.width >= 24 && rect.height >= 8 && rect.height <= 80
  );
  const bars = mostFrequentGroup(candidates, (rect) => roundedGroup(rect.x));
  if (bars.length < 3) return null;
  const rows = bars.flatMap((bar) => {
    const centerY = bar.y + bar.height / 2;
    const category = texts.filter((text) =>
      text.x < bar.x
      && bar.x - text.x <= 180
      && Math.abs(text.y - centerY) <= Math.max(12, bar.height)
      && !visibleNumber(text.text)
    ).sort((a, b) => Math.abs(a.y - centerY) - Math.abs(b.y - centerY))[0];
    const valueLabel = texts.filter((text) =>
      text.x >= bar.x + bar.width - 4
      && text.x <= bar.x + bar.width + 100
      && Math.abs(text.y - centerY) <= Math.max(12, bar.height)
      && visibleNumber(text.text)
    ).sort((a, b) =>
      Math.abs(a.x - (bar.x + bar.width))
      - Math.abs(b.x - (bar.x + bar.width))
    )[0];
    const value = valueLabel ? visibleNumber(valueLabel.text) : null;
    return category && value && valueLabel ? [{
      bar,
      category: category.text,
      value: value.value,
      suffix: value.suffix,
      valueColor: valueLabel.element.getAttribute("fill") ?? undefined
    }] : [];
  }).sort((a, b) => a.bar.y - b.bar.y);
  if (rows.length < 3) {
    return null;
  }
  if (new Set(rows.map((row) => row.category)).size !== rows.length) {
    const maxBarBottom = Math.max(...bars.map((bar) => bar.y + bar.height));
    const groupLabels = texts.filter((text) =>
      text.y >= maxBarBottom + 30
      && !visibleNumber(text.text)
    );
    const childOrder = new Map(
      [...svg.children].map((element, index) => [element, index])
    );
    const groupedRows = rows.flatMap((row) => {
      const barIndex = childOrder.get(row.bar.element);
      if (barIndex === undefined) return [];
      const group = groupLabels
        .filter((label) =>
          (childOrder.get(label.element) ?? Number.POSITIVE_INFINITY) < barIndex
        )
        .sort((a, b) =>
          (childOrder.get(b.element) ?? 0) - (childOrder.get(a.element) ?? 0)
        )[0];
      return group ? [{ ...row, group: group.text }] : [];
    });
    const groups = [...new Set(groupedRows.map((row) => row.group))];
    const seriesNames = [...new Set(groupedRows.map((row) => row.category))];
    const complete = groups.length >= 2
      && seriesNames.length >= 2
      && groups.every((group) =>
        seriesNames.every((seriesName) =>
          groupedRows.some((row) =>
            row.group === group && row.category === seriesName
          )
        )
      );
    if (!complete) return null;
    const series = seriesNames.map((name) => {
      const matching = groupedRows.filter((row) => row.category === name);
      const color = matching.find((row) => row.bar.fill)?.bar.fill;
      return {
        name,
        data: groups.map((group) =>
          matching.find((row) => row.group === group)?.value ?? 0
        ),
        ...(color ? { color } : {})
      };
    });
    const palette = series.flatMap((item) => item.color ? [item.color] : []);
    const radius = numericAttribute(groupedRows[0]!.bar.element, "rx");
    const opacity = numericAttribute(groupedRows[0]!.bar.element, "opacity");
    const suffix = groupedRows.find((row) => row.suffix)?.suffix ?? "";
    return {
      data: { labels: groups, series },
      ...(palette[0] ? { primaryColor: palette[0] } : {}),
      suggestedType: "bar",
      confidence: "medium",
      reason: `已根据 SVG 绘制顺序恢复 ${series.length} 个系列、${groups.length} 个分组`,
      style: {
        ...baseStyle(svg),
        palette,
        barOrientation: "horizontal",
        showValues: true,
        ...(suffix ? { valueSuffix: suffix } : {}),
        ...(radius !== undefined ? { barRadius: radius } : {}),
        ...(opacity !== undefined ? { barOpacity: opacity } : {})
      }
    };
  }
  const palette = rows.flatMap((row) => row.bar.fill ? [row.bar.fill] : []);
  const radius = numericAttribute(rows[0]!.bar.element, "rx");
  const opacity = numericAttribute(rows[0]!.bar.element, "opacity");
  const suffix = rows.find((row) => row.suffix)?.suffix ?? "";
  return {
    data: {
      labels: rows.map((row) => row.category),
      series: [{
        name: "数值",
        data: rows.map((row) => row.value),
        ...(palette[0] ? { color: palette[0] } : {})
      }]
    },
    ...(palette[0] ? { primaryColor: palette[0] } : {}),
    suggestedType: "bar",
    confidence: "high",
    reason: `已根据柱形、分类标签和数值标签恢复 ${rows.length} 个横向柱`,
    style: {
      ...baseStyle(svg),
      palette: [...new Set(palette)],
      categoryColors: palette,
      categoryLabelColors: rows.map((row) =>
        row.valueColor ?? row.bar.fill ?? baseStyle(svg).mutedColor ?? "#738196"
      ),
      barOrientation: "horizontal",
      showValues: true,
      ...(suffix ? { valueSuffix: suffix } : {}),
      ...(radius !== undefined ? { barRadius: radius } : {}),
      ...(opacity !== undefined ? { barOpacity: opacity } : {})
    }
  };
}

function recoverVerticalBars(
  svg: SVGSVGElement,
  rects: SvgRectGeometry[],
  texts: SvgTextGeometry[]
): RecoveredChart | null {
  const candidates = rects.filter((rect) =>
    rect.width >= 8 && rect.height >= 8 && rect.width <= 180
  );
  const bars = mostFrequentGroup(
    candidates,
    (rect) => roundedGroup(rect.y + rect.height)
  );
  if (bars.length < 3) return null;
  const baseline = bars.reduce(
    (sum, bar) => sum + bar.y + bar.height,
    0
  ) / bars.length;
  const categoryLabels = texts.filter((text) =>
    text.y >= baseline + 4
    && text.y <= baseline + 40
    && !visibleNumber(text.text)
  );
  const entries = bars.flatMap((bar) => {
    const centerX = bar.x + bar.width / 2;
    const valueLabel = texts.filter((text) =>
      Math.abs(text.x - centerX) <= Math.max(16, bar.width * 0.7)
      && text.y <= bar.y + 6
      && bar.y - text.y <= 45
      && visibleNumber(text.text)
    ).sort((a, b) =>
      Math.abs(a.y - bar.y) - Math.abs(b.y - bar.y)
    )[0];
    const value = valueLabel ? visibleNumber(valueLabel.text) : null;
    const category = categoryLabels.sort((a, b) =>
      Math.abs(a.x - centerX) - Math.abs(b.x - centerX)
    )[0];
    return category && value && valueLabel ? [{
      bar,
      category: category.text,
      value: value.value,
      suffix: value.suffix,
      valueColor: valueLabel.element.getAttribute("fill") ?? undefined
    }] : [];
  }).sort((a, b) => a.bar.x - b.bar.x);
  if (entries.length < 3) return null;

  const distinctCategories = [...new Set(entries.map((entry) => entry.category))];
  const colors = [...new Set(entries.flatMap((entry) =>
    entry.bar.fill ? [entry.bar.fill] : []
  ))];
  const legend = legendNamesByColor(
    rects,
    texts,
    new Set(entries.map((entry) => entry.bar.element))
  );
  const suffix = entries.find((entry) => entry.suffix)?.suffix ?? "";
  const series = colors.length > 1 && distinctCategories.length < entries.length
    ? colors.map((color, index) => ({
      name: legend.get(color) ?? `系列 ${index + 1}`,
      color,
      data: distinctCategories.map((category) =>
        entries.find((entry) =>
          entry.category === category && entry.bar.fill === color
        )?.value ?? 0
      )
    }))
    : [{
      name: "数值",
      data: entries.map((entry) => entry.value),
      ...(colors[0] ? { color: colors[0] } : {})
    }];
  const labels = series.length > 1
    ? distinctCategories
    : entries.map((entry) => entry.category);
  if (new Set(labels).size !== labels.length) return null;
  const radius = numericAttribute(entries[0]!.bar.element, "rx");
  const opacity = numericAttribute(entries[0]!.bar.element, "opacity");
  const categoryColors = series.length === 1
    ? entries.flatMap((entry) => entry.bar.fill ? [entry.bar.fill] : [])
    : undefined;
  const categoryLabelColors = series.length === 1
    ? entries.map((entry) =>
      entry.valueColor
        ?? entry.bar.fill
        ?? baseStyle(svg).mutedColor
        ?? "#738196"
    )
    : undefined;
  return {
    data: { labels, series },
    ...(colors[0] ? { primaryColor: colors[0] } : {}),
    suggestedType: "bar",
    confidence: "high",
    reason: `已根据柱形、坐标标签和数值标签恢复 ${series.length} 个系列、${labels.length} 个分类`,
    style: {
      ...baseStyle(svg),
      palette: colors,
      barOrientation: "vertical",
      showValues: true,
      ...(categoryColors ? { categoryColors } : {}),
      ...(categoryLabelColors ? { categoryLabelColors } : {}),
      ...(suffix ? { valueSuffix: suffix } : {}),
      ...(radius !== undefined ? { barRadius: radius } : {}),
      ...(opacity !== undefined ? { barOpacity: opacity } : {})
    }
  };
}

function recoverBars(svg: SVGSVGElement): RecoveredChart | null {
  const rects = rectGeometry(svg);
  const texts = textGeometry(svg);
  return recoverHorizontalBars(svg, rects, texts)
    ?? recoverVerticalBars(svg, rects, texts);
}

function recoverPie(svg: SVGSVGElement): RecoveredChart | null {
  const entries: Array<{ label: string; value: number; color?: string }> = [];
  for (const path of svg.querySelectorAll<SVGPathElement>("path")) {
    const match = titleText(path).match(/^(.+?)\s*[:：]\s*(-?\d+(?:\.\d+)?)\s*%?$/);
    if (!match) continue;
    const value = parseNumber(match[2]!);
    if (value === null) continue;
    const color = path.getAttribute("fill");
    entries.push({
      label: match[1]!.trim(),
      value,
      ...(color ? { color } : {})
    });
  }
  if (entries.length < 3) return null;
  const primaryColor = entries[0]?.color;
  const paths = [...svg.querySelectorAll<SVGPathElement>("path")]
    .filter((path) => titleText(path));
  const centerCircle = [...svg.querySelectorAll<SVGCircleElement>("circle")]
    .filter((circle) => !titleText(circle))
    .sort((a, b) => (numericAttribute(b, "r") ?? 0)
      - (numericAttribute(a, "r") ?? 0))[0];
  const centerTexts = [...svg.querySelectorAll<SVGTextElement>(
    'text[text-anchor="middle"]'
  )].sort((a, b) => (numericAttribute(b, "font-size") ?? 0)
    - (numericAttribute(a, "font-size") ?? 0));
  const centerText = centerTexts[0];
  const centerSubtext = centerTexts.find((item) => item !== centerText
    && numericAttribute(item, "font-size") !== undefined);
  const pathRadius = paths[0]?.getAttribute("d")
    ?.match(/\bA\s*([-\d.]+)/i)?.[1];
  const outerRadius = pathRadius ? Number.parseFloat(pathRadius) : undefined;
  const innerRadius = centerCircle
    ? numericAttribute(centerCircle, "r")
    : undefined;
  const borderWidth = paths[0]
    ? numericAttribute(paths[0], "stroke-width")
    : undefined;
  const itemOpacity = paths[0]
    ? numericAttribute(paths[0], "opacity")
    : undefined;
  const style: ChartStyleProfile = {
    ...baseStyle(svg),
    palette: entries.flatMap((entry) => entry.color ? [entry.color] : []),
    ...(paths[0]?.getAttribute("stroke")
      ? { borderColor: paths[0].getAttribute("stroke")! }
      : {}),
    ...(borderWidth !== undefined ? { borderWidth } : {}),
    ...(itemOpacity !== undefined ? { itemOpacity } : {}),
    ...(outerRadius && innerRadius
      ? { pieInnerRatio: innerRadius / outerRadius }
      : {}),
    ...(centerText?.textContent?.trim()
      ? { pieCenterText: centerText.textContent.trim() }
      : {}),
    ...(centerSubtext?.textContent?.trim()
      ? { pieCenterSubtext: centerSubtext.textContent.trim() }
      : {}),
    ...(centerText?.getAttribute("fill")
      ? { pieCenterColor: centerText.getAttribute("fill")! }
      : {}),
    ...(centerSubtext?.getAttribute("fill")
      ? { pieCenterSubtextColor: centerSubtext.getAttribute("fill")! }
      : {})
  };
  return {
    data: {
      labels: entries.map((entry) => entry.label),
      series: [{
        name: "占比",
        data: entries.map((entry) => entry.value),
        ...(primaryColor ? { color: primaryColor } : {})
      }]
    },
    ...(primaryColor ? { primaryColor } : {}),
    suggestedType: "pie",
    confidence: "high",
    reason: `已从 SVG 提示信息恢复 ${entries.length} 个分类及数值`,
    style
  };
}

function recoverPointSeries(svg: SVGSVGElement): RecoveredChart | null {
  const points: Array<{
    series: string;
    label: string;
    value: number;
    color?: string;
  }> = [];
  const hourly = /^(.+?)\s+(\d{1,2}:00)\s*=\s*(-?\d+(?:\.\d+)?)$/;
  const textRange =
    /^(.+?)\s+((?:\d+\s*-\s*\d+|\d+\+)字)\s*[:：]\s*(-?\d+(?:\.\d+)?)$/;

  for (const circle of svg.querySelectorAll<SVGCircleElement>("circle")) {
    const raw = titleText(circle);
    const match = raw.match(hourly) ?? raw.match(textRange);
    if (!match) continue;
    const value = parseNumber(match[3]!);
    if (value === null) continue;
    const color = circle.getAttribute("fill");
    points.push({
      series: match[1]!.trim(),
      label: match[2]!.replace(/\s+/g, ""),
      value,
      ...(color ? { color } : {})
    });
  }
  if (points.length < 3) return null;

  const labels = [...new Set(points.map((point) => point.label))];
  const names = [...new Set(points.map((point) => point.series))];
  const series = names.map((name) => {
    const byLabel = new Map(
      points.filter((point) => point.series === name)
        .map((point) => [point.label, point])
    );
    return {
      name,
      data: labels.map((label) => byLabel.get(label)?.value ?? null),
      color: points.find((point) => point.series === name)?.color
    };
  });
  if (series.some((item) => item.data.some((value) => value === null))) {
    return null;
  }

  const primaryColor = series[0]?.color;
  const polygon = svg.querySelector<SVGPolygonElement>("polygon[opacity]");
  const polyline = svg.querySelector<SVGPolylineElement>("polyline");
  const point = [...svg.querySelectorAll<SVGCircleElement>("circle")]
    .find((circle) => titleText(circle));
  const areaOpacity = polygon
    ? numericAttribute(polygon, "opacity")
    : undefined;
  const lineWidth = polyline
    ? numericAttribute(polyline, "stroke-width")
    : undefined;
  const pointRadius = point ? numericAttribute(point, "r") : undefined;
  const style: ChartStyleProfile = {
    ...baseStyle(svg),
    palette: series.flatMap((item) => item.color ? [item.color] : []),
    ...(areaOpacity !== undefined ? { areaOpacity } : {}),
    ...(lineWidth !== undefined ? { lineWidth } : {}),
    ...(pointRadius !== undefined ? { symbolSize: pointRadius * 2 } : {})
  };
  return {
    data: {
      labels,
      series: series.map((item) => ({
        name: item.name,
        data: item.data as number[],
        ...(item.color ? { color: item.color } : {})
      }))
    },
    ...(primaryColor ? { primaryColor } : {}),
    suggestedType: "line",
    confidence: "high",
    reason: `已从 SVG 提示信息恢复 ${series.length} 个系列、${labels.length} 个数据点`,
    style
  };
}

type SvgChartRecoverer = (
  svg: SVGSVGElement
) => RecoveredChart | null;

const SVG_CHART_RECOVERERS: readonly SvgChartRecoverer[] = [
  recoverPie,
  recoverPointSeries,
  recoverBars
];

function recover(svg: SVGSVGElement): RecoveredChart {
  for (const recoverer of SVG_CHART_RECOVERERS) {
    const recovered = recoverer(svg);
    if (recovered) return recovered;
  }
  return {
    confidence: "low",
    reason: "已识别为图表，但 SVG 中缺少可靠的数据语义，暂不自动转换"
  };
}

export function styleProfileForSvg(
  svg: SVGSVGElement
): ChartStyleProfile | undefined {
  return recover(svg).style;
}

function descriptorOf(svg: SVGSVGElement): string {
  const container = svg.parentElement;
  return [
    svg.id,
    svg.getAttribute("class"),
    svg.getAttribute("aria-label"),
    container?.id,
    container?.getAttribute("class"),
    container?.getAttribute("aria-label")
  ].filter(Boolean).join(" ");
}

function looksLikeChart(svg: SVGSVGElement): boolean {
  if (svg.closest("[_echarts_instance_], [data-hs-chart]")) return false;
  if (/logo|icon|avatar|badge|illustration|decoration/i.test(descriptorOf(svg))) {
    return false;
  }
  const rect = svg.getBoundingClientRect();
  if (rect.width < 240 || rect.height < 140) return false;
  const shapes = svg.querySelectorAll("path, rect, circle, line, polyline, polygon");
  const labels = svg.querySelectorAll("text");
  const dataShapes = svg.querySelectorAll(
    "polyline, path, rect, circle > title, path > title"
  );
  const explicitValues = svg.querySelectorAll(
    "circle > title, path > title"
  ).length;
  const barLike = svg.querySelectorAll("rect").length >= 3
    && labels.length >= 6;
  return (shapes.length >= 6 || explicitValues >= 3 || barLike)
    && labels.length >= 3
    && dataShapes.length >= 1;
}

class SvgChartHandle implements ChartHandle {
  constructor(
    readonly element: HTMLElement,
    private readonly svg: SVGSVGElement
  ) {}

  snapshot(): Omit<ChartSnapshot, "key"> {
    const recovered = recover(this.svg);
    const heading = this.element.parentElement
      ?.querySelector<HTMLElement>(":scope > h1, :scope > h2, :scope > h3");
    return {
      engine: "svg",
      editable: false,
      title: heading?.textContent?.trim(),
      legendVisible: true,
      primaryColor: recovered.primaryColor,
      data: recovered.data,
      conversion: {
        supported: Boolean(recovered.data && recovered.suggestedType),
        confidence: recovered.confidence,
        ...(recovered.suggestedType
          ? { suggestedType: recovered.suggestedType }
          : {}),
        reason: recovered.reason,
        ...(recovered.style ? { style: recovered.style } : {})
      }
    };
  }

  apply(patch: ChartPatch): void {
    void patch;
  }

  resize(): void {
    this.svg.style.maxWidth = "100%";
  }
}

export class SvgChartAdapter implements ChartAdapter {
  find(target: Element): ChartHandle | null {
    const svg = target instanceof SVGSVGElement
      ? target
      : target.closest<SVGSVGElement>("svg");
    if (!svg || !looksLikeChart(svg)) return null;
    const container = persistentContainer(svg);
    return container ? new SvgChartHandle(container, svg) : null;
  }

  findByElement(element: HTMLElement): ChartHandle | null {
    const svg = element instanceof SVGSVGElement
      ? element
      : element.querySelector<SVGSVGElement>(":scope > svg, svg");
    if (!svg || !looksLikeChart(svg)) return null;
    const container = persistentContainer(svg);
    if (!container || container !== element) return null;
    return new SvgChartHandle(container, svg);
  }
}
