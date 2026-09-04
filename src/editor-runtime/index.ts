import type { CommandPayload, StyleDeclaration } from "../domain/commands/schema";
import * as bundledECharts from "echarts";
import "echarts-wordcloud";
import {
  canEditPlainText,
  canEditRichText,
  explicitDeclaration,
  idOf,
  inlineDeclaration,
  isDynamicId,
  isRepeatedComponent,
  persistentAnchorOf,
  persistedIdOf,
  richTextContainerFor,
  ROOT_NODE_ID,
  selectionFor
} from "./dom";
import { DynamicNodeManager, DYNAMIC_PATCH_ATTRIBUTE } from "./dynamic-nodes";
import { ResponsiveController } from "./features/responsive-controller";
import { ThemeController } from "./features/theme-controller";
import { WatermarkController } from "./features/watermark-controller";
import { DocumentNavigator } from "./features/document-navigator";
import { ComponentController } from "./features/component-controller";
import {
  beginFlowDrag,
  finishFlowDrag,
  updateFlowDrag,
  type FlowDrag
} from "./flow-reorder";
import {
  beginFreeDrag,
  finishFreeDrag,
  updateFreeDrag,
  type FreeDrag
} from "./free-drag";
import { placeImage } from "./image-placement";
import {
  isHostMessage,
  postToHost,
  type EditorState,
  type LayerNode,
  type SelectionSnapshot
} from "./protocol";
import { SelectionOverlay, type ResizeDirection } from "./selection-overlay";
import { ChartRegistry } from "./charts/chart-registry";
import { styleProfileForSvg } from "./charts/svg-chart-adapter";
import type { ChartPatch, ChartStyleProfile } from "./charts/types";
import {
  declarationsForPreset,
  presetSignature,
  styleTargetForElement
} from "./features/style-preset-extractor";
import type {
  StylePreset,
  StylePresetTarget
} from "../domain/styles/style-preset";

interface ResizeDrag {
  mode: "resize";
  element: HTMLElement;
  direction: ResizeDirection;
  startX: number;
  startY: number;
  width: number;
  height: number;
  left: number;
  top: number;
  aspectRatio: number | null;
  isAbsolute: boolean;
  beforeWidth: StyleDeclaration;
  beforeHeight: StyleDeclaration;
  beforeLeft?: StyleDeclaration;
  beforeTop?: StyleDeclaration;
}

interface PendingDrag {
  mode: "pending";
  kind: "flow" | "free";
  element: HTMLElement;
  elements: HTMLElement[];
  pointerId: number;
  startX: number;
  startY: number;
}

interface ImageSlotCandidate {
  container: HTMLElement;
  kind: "image" | "container" | "background";
  image?: HTMLImageElement;
}

type DragState = FlowDrag | FreeDrag | ResizeDrag | PendingDrag;
type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom";
const GEOMETRY_PROPERTIES = [
  "position", "left", "right", "top", "bottom", "width", "height", "margin"
] as const;
const FREE_ORIGIN_PROPERTY = "--hs-free-origin";
const FREE_CONTAINER_ORIGIN_PROPERTY = "--hs-free-container-origin";

function encodeFreeOrigin(declarations: StyleDeclaration[]): string {
  return encodeURIComponent(JSON.stringify(declarations));
}

function decodeFreeOrigin(value: string): StyleDeclaration[] | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((entry): entry is StyleDeclaration =>
      entry
      && typeof entry === "object"
      && typeof entry.property === "string"
      && typeof entry.value === "string"
      && (entry.priority === "" || entry.priority === "important")
      && typeof entry.existed === "boolean"
    );
  } catch {
    return null;
  }
}

function applyStyleDeclarations(
  element: HTMLElement,
  declarations: StyleDeclaration[]
): void {
  for (const declaration of declarations) {
    if (!declaration.existed) {
      element.style.removeProperty(declaration.property);
    } else {
      element.style.setProperty(
        declaration.property,
        declaration.value,
        declaration.priority
      );
    }
  }
}

function computeResizeDimensions(
  direction: ResizeDirection,
  startW: number,
  startH: number,
  dx: number,
  dy: number,
  lockRatio: number | null
): { width: number; height: number } {
  let w: number = startW;
  let h: number = startH;
  const mulX = (direction.includes("e") ? 1 : direction.includes("w") ? -1 : 0);
  const mulY = (direction.includes("s") ? 1 : direction.includes("n") ? -1 : 0);
  w = startW + dx * mulX;
  h = startH + dy * mulY;
  w = Math.max(12, w);
  h = Math.max(12, h);
  if (lockRatio !== null && lockRatio > 0) {
    const wDelta = Math.abs(w - startW);
    const hDelta = Math.abs(h - startH);
    if (wDelta >= hDelta) {
      h = Math.max(12, w / lockRatio);
    } else {
      w = Math.max(12, h * lockRatio);
    }
  }
  return { width: Math.round(w), height: Math.round(h) };
}

function computeResizePosition(
  direction: ResizeDirection,
  startW: number,
  startH: number,
  newW: number,
  newH: number,
  currentLeft: number,
  currentTop: number
): { left?: number; top?: number } {
  const dw = startW - newW;
  const dh = startH - newH;
  const result: { left?: number; top?: number } = {};
  if (direction.includes("w")) result.left = Math.round(currentLeft + dw);
  if (direction.includes("n")) result.top = Math.round(currentTop + dh);
  return result;
}

// ---- Phase 6: Chart Block helpers ----

interface ChartBlockData {
  type: "line" | "bar" | "area" | "pie";
  xAxis: string[];
  series: Array<{ name: string; data: number[]; color?: string }>;
  color: string;
  title?: string;
  legendVisible?: boolean;
  style?: ChartStyleProfile;
}

interface EChartInstance {
  setOption(o: Record<string, unknown>, opts?: Record<string, unknown>): void;
  resize(): void;
  getOption(): Record<string, unknown>;
  convertToPixel?(coord: string, point: unknown): [number, number];
  convertFromPixel?(coord: string, point: [number, number]): [string | number, number];
}

function getDefaultChartData(): ChartBlockData {
  return {
    type: "line",
    xAxis: ["1月","2月","3月","4月","5月","6月"],
    series: [{ name: "销量", data: [120,200,150,80,70,110] }],
    color: "#4f7cff",
    title: ""
  };
}

function buildEChartsOption(config: ChartBlockData): Record<string, unknown> {
  const style = config.style;
  const palette = style?.palette.length
    ? style.palette
    : config.series.flatMap((series) => series.color ? [series.color] : []);
  const mutedColor = style?.mutedColor ?? "#738196";
  const fontFamily = style?.fontFamily;
  if (config.type === "pie") {
    const s = config.series[0];
    const pieData = s
      ? (config.xAxis).map((label: string, i: number) => ({
        name: label,
        value: s.data[i] ?? 0,
        itemStyle: {
          color: palette[i] ?? config.color,
          opacity: style?.itemOpacity ?? 1,
          borderColor: style?.borderColor ?? "transparent",
          borderWidth: style?.borderWidth ?? 0
        },
        label: { color: palette[i] ?? mutedColor }
      }))
      : [];
    const outerRadius = 66;
    const innerRadius = Math.round(
      outerRadius * (style?.pieInnerRatio ?? 0.45)
    );
    const centerText = style?.pieCenterText;
    const centerSubtext = style?.pieCenterSubtext;
    const valueByName = new Map(
      config.xAxis.map((label, index) => [
        label,
        s?.data[index] ?? 0
      ])
    );
    return {
      color: palette,
      backgroundColor: "transparent",
      textStyle: { color: mutedColor, fontFamily },
      tooltip: { trigger: "item" },
      title: config.title ? { text: config.title, left: "center", textStyle: { fontSize: 13 } } : undefined,
      legend: {
        show: config.legendVisible ?? true,
        bottom: 0,
        type: "scroll",
        itemWidth: 12,
        itemHeight: 8,
        formatter: (name: string) =>
          `${name} ${valueByName.get(name) ?? 0}%`,
        textStyle: { color: mutedColor, fontFamily, fontSize: 11 }
      },
      graphic: centerText || centerSubtext ? [
        ...(centerText ? [{
          type: "text",
          left: "center",
          top: centerSubtext ? "41%" : "44%",
          silent: true,
          style: {
            text: centerText,
            fill: style?.pieCenterColor ?? style?.textColor ?? "#ffffff",
            fontFamily,
            fontSize: 28,
            fontWeight: 700,
            textAlign: "center"
          }
        }] : []),
        ...(centerSubtext ? [{
          type: "text",
          left: "center",
          top: "50%",
          silent: true,
          style: {
            text: centerSubtext,
            fill: style?.pieCenterSubtextColor ?? mutedColor,
            fontFamily,
            fontSize: 14,
            textAlign: "center"
          }
        }] : [])
      ] : undefined,
      series: [{
        type: "pie",
        radius: [`${innerRadius}%`, `${outerRadius}%`],
        center: ["50%", "46%"],
        data: pieData,
        avoidLabelOverlap: true,
        label: {
          show: true,
          position: "outside",
          formatter: "{b} {c}%",
          fontFamily,
          fontSize: 12
        },
        labelLine: { show: false },
        emphasis: {
          scaleSize: 4,
          itemStyle: {
            shadowBlur: 10,
            shadowColor: "rgba(0,0,0,0.3)"
          }
        }
      }]
    };
  }
  const seriesType = config.type === "area" ? "line" : config.type;
  const horizontalBars =
    config.type === "bar" && style?.barOrientation === "horizontal";
  const categoryAxis = {
    type: "category",
    data: config.xAxis,
    boundaryGap: seriesType === "bar",
    axisLine: { lineStyle: { color: style?.gridColor ?? "#d9deea" } },
    axisTick: { show: false },
    axisLabel: {
      color: mutedColor,
      fontFamily,
      fontSize: 10,
      interval: config.xAxis.length > 12 ? 2 : 0
    }
  };
  const valueAxis = {
    type: "value",
    axisLabel: { color: mutedColor, fontFamily, fontSize: 10 },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: {
      lineStyle: {
        color: style?.gridColor ?? "#d9deea",
        type: "dashed"
      }
    }
  };
  return {
    color: palette,
    backgroundColor: "transparent",
    textStyle: { color: mutedColor, fontFamily },
    tooltip: { trigger: "axis" },
    legend: {
      show: (config.legendVisible ?? true) && config.series.length > 1,
      top: 0,
      left: 60,
      itemWidth: 14,
      itemHeight: 10,
      textStyle: { color: mutedColor, fontFamily, fontSize: 11 }
    },
    grid: horizontalBars
      ? { left: 80, right: 70, top: config.title ? 52 : 20, bottom: 30 }
      : { left: 60, right: 60, top: config.title ? 52 : 30, bottom: 50 },
    title: config.title ? { text: config.title, left: 10, top: 5, textStyle: { fontSize: 13, fontWeight: "normal" } } : undefined,
    xAxis: horizontalBars ? valueAxis : categoryAxis,
    yAxis: horizontalBars
      ? { ...categoryAxis, inverse: true }
      : valueAxis,
    series: config.series.map((s, seriesIndex) => ({
      type: seriesType,
      name: s.name,
      data: config.type === "bar"
        ? s.data.map((value, index) => ({
          value,
          itemStyle: {
            color: style?.categoryColors?.[index]
              ?? s.color
              ?? palette[seriesIndex]
              ?? config.color,
            opacity: style?.barOpacity ?? 1,
            borderRadius: style?.barRadius ?? 0
          },
          ...(style?.categoryLabelColors?.[index]
            ? { label: { color: style.categoryLabelColors[index] } }
            : {})
        }))
        : s.data,
      smooth: seriesType === "line",
      symbol: "circle",
      symbolSize: style?.symbolSize ?? 8,
      areaStyle: config.type === "area" || style?.areaOpacity !== undefined
        ? { opacity: style?.areaOpacity ?? 0.3 }
        : undefined,
      itemStyle: { color: s.color ?? config.color },
      label: config.type === "bar" && style?.showValues
        ? {
          show: true,
          position: horizontalBars ? "right" : "top",
          color: s.color ?? palette[seriesIndex] ?? mutedColor,
          fontFamily,
          fontSize: 11,
          fontWeight: 600,
          formatter: `{c}${style?.valueSuffix ?? ""}`
        }
        : undefined,
      lineStyle: {
        color: s.color ?? config.color,
        width: style?.lineWidth ?? 2
      }
    }))
  };
}

// ---- Runtime class ----

class EditorRuntime {
  private readonly selected = new Set<HTMLElement>();
  private primary: HTMLElement | null = null;
  private drag: DragState | null = null;
  private pendingImagePath: string | null = null;
  private readonly overlay = new SelectionOverlay();
  private readonly charts = new ChartRegistry();
  private readonly dynamicNodes = new DynamicNodeManager();
  private readonly responsive = new ResponsiveController(
    (payload) => this.commit(payload)
  );
  private readonly theme = new ThemeController(
    (payload) => this.commit(payload)
  );
  private readonly watermarks = new WatermarkController(
    (payload) => this.commit(payload),
    (watermarkId) => postToHost({
      type: "watermark-selected",
      watermarkId
    }),
    (settings) => postToHost({
      type: "watermarks-changed",
      settings
    })
  );
  private readonly navigator = new DocumentNavigator();
  private readonly components = new ComponentController(
    (payload) => this.commit(payload)
  );
  // Track pointer-down state to distinguish click from drag
  private pointerDown: { x: number; y: number; target: HTMLElement; dragMoved: boolean } | null = null;
  private contentEditable: HTMLElement | null = null;
  private contentEditableCommitTarget: HTMLElement | null = null;
  private contentEditableBeforeHtml: string | null = null;
  private lastMouseWasDrag = false;
  private readonly stylePreviewBefore = new Map<string, StyleDeclaration>();
  private readonly textPreviewBefore = new Map<string, string>();
  private imageSlotSelectionMode = false;
  private imageSlotCandidates: ImageSlotCandidate[] = [];
  private selectedImageSlots: ImageSlotCandidate[] = [];
  private imageSlotOverlay: HTMLElement | null = null;
  private savedTextRange: Range | null = null;
  private formatPainterDeclarations: StyleDeclaration[] | null = null;
  private textStylePreview: {
    host: HTMLElement;
    span: HTMLSpanElement;
    property: string;
    beforeHtml: string;
  } | null = null;

  start(): void {
    const runtimeWindow = window as typeof window & { echarts?: unknown };
    if (!runtimeWindow.echarts) runtimeWindow.echarts = bundledECharts;
    this.installEditorEnvironment();
    this.dynamicNodes.start();
    window.addEventListener("scroll", () => {
      this.updateOverlay();
      this.renderImageSlotOverlays();
    }, true);
    window.addEventListener("resize", () => {
      this.updateOverlay();
      this.renderImageSlotOverlays();
    });
    window.addEventListener("message", (event) => this.onHostMessage(event));
    window.addEventListener(
      "click",
      (event) => this.onWatermarkActivation(event),
      true
    );
    // Single click — select (immediate, no timer)
    document.addEventListener("click", (event) => this.onClick(event), true);
    // Double click — enter edit mode
    document.addEventListener("dblclick", (event) => this.onDoubleClick(event), true);
    // Track pointer for drag/click distinction
    document.addEventListener("mousedown", (event) => this.onMouseDown(event), true);
    document.addEventListener("mousemove", (event) => this.onMouseMove(event), true);
    document.addEventListener("mouseup", (event) => this.onMouseUp(event), true);
    document.addEventListener("contextmenu", (event) => this.onContextMenu(event), true);
    document.addEventListener("keydown", (event) => this.onKeyDown(event), true);
    // GrapesJS-style hover outline
    document.addEventListener("mouseover", (event) => this.onHover(event), true);
    document.addEventListener("mouseout", (event) => this.onHoverEnd(event), true);
    // Detect text selection for inline styles
    document.addEventListener("selectionchange", () => {
      this.onSelectionChange();
    }, true);
    queueMicrotask(() => this.charts.restoreOverrides());
    window.setTimeout(() => this.charts.restoreOverrides(), 250);
    window.setTimeout(() => this.charts.restoreOverrides(), 1000);
    // Phase 6: initialize user-inserted chart elements
    window.setTimeout(() => this.initChartElements(), 500);
    postToHost({ type: "ready" });
    this.emitImageSlotSelection();
  }

  private installEditorEnvironment(): void {
    const style = document.createElement("style");
    style.dataset.hsRuntimeStyle = "true";
    style.textContent = `
      html {
        scroll-behavior: auto !important;
        scroll-snap-type: none !important;
      }
      body, [style*="scroll-snap-type"] {
        scroll-snap-type: none !important;
      }
      [style*="scroll-snap-align"] {
        scroll-snap-align: none !important;
      }
      /*
       * Entrance animations frequently start at opacity: 0 and depend on a
       * later script callback. A failure in an unrelated page module must not
       * make otherwise editable content disappear from the authoring canvas.
       */
      .fade {
        opacity: 1 !important;
        transform: none !important;
      }
      img {
        -webkit-user-drag: none;
        user-select: none;
      }
      /* GrapesJS-style hover outline */
      .hs-hover-outline {
        outline: 1px dashed rgba(79,124,255,0.55) !important;
        outline-offset: 2px !important;
      }
      @keyframes hs-locate-pulse {
        0%, 100% { box-shadow: 0 0 0 3px rgba(37,99,235,.24); }
        45% { box-shadow: 0 0 0 8px rgba(37,99,235,.48); }
      }
      .hs-locate-flash {
        outline: 3px solid #2563eb !important;
        outline-offset: 4px !important;
        animation: hs-locate-pulse .75s ease-in-out 2 !important;
      }
    `;
    (document.head ?? document.documentElement).appendChild(style);
  }

  private selectionElements(): HTMLElement[] {
    return [...this.selected].filter((element) => element.isConnected);
  }

  private normalizeObjectSelection(
    elements: HTMLElement[]
  ): HTMLElement[] {
    if (elements.length < 2) return elements;
    let commonParent = elements[0]?.parentElement ?? null;
    while (
      commonParent
      && !elements.every((element) => commonParent!.contains(element))
    ) {
      commonParent = commonParent.parentElement;
    }
    if (!commonParent || commonParent === document.documentElement) {
      return elements;
    }
    const promoted = elements.map((element) => {
      let current = element;
      while (
        current.parentElement
        && current.parentElement !== commonParent
      ) {
        current = current.parentElement;
      }
      return current;
    });
    const unique = [...new Set(promoted)];
    return unique.length >= 2 ? unique : elements;
  }

  private replaceSelection(elements: HTMLElement[]): void {
    const previousPrimary = this.primary;
    this.selected.clear();
    for (const element of elements) this.selected.add(element);
    this.primary = elements.find((element) =>
      previousPrimary ? element.contains(previousPrimary) : false
    ) ?? elements.at(-1) ?? null;
  }

  private updateOverlay(): void {
    this.overlay.update(this.selectionElements(), this.primary);
  }

  private emitSelection(): void {
    const elements = this.selectionElements();
    const primary = this.primary?.isConnected ? this.primary : elements.at(-1) ?? null;
    this.primary = primary;
    this.updateOverlay();
    if (!primary) {
      postToHost({ type: "notice", message: "未选择对象" });
      postToHost({
        type: "selection",
        selection: {
          count: 0, nodeIds: [], nodeId: "", tagName: "",
          textAlign: "", fontSize: "", position: "",
          isComponent: false, width: 0, height: 0,
          text: "", canEditText: false
        }
      });
      return;
    }
    const computed = getComputedStyle(primary);
    const rect = primary.getBoundingClientRect();
    const chartHandle = this.charts.findByElement(primary)
      ?? this.charts.find(primary);
    const chart = chartHandle ? this.charts.snapshot(chartHandle) : undefined;
    const selection: SelectionSnapshot = {
      count: elements.length,
      nodeIds: elements.map(idOf),
      nodeId: idOf(primary),
      tagName: primary.tagName.toLowerCase(),
      textAlign: computed.textAlign,
      fontSize: computed.fontSize,
      position: computed.position,
      freeMovement:
        primary.style.getPropertyValue(FREE_ORIGIN_PROPERTY) !== "",
      zIndex: Number.parseInt(computed.zIndex, 10) || 0,
      isComponent: isRepeatedComponent(primary),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      text: primary.textContent ?? "",
      canEditText: !chart && canEditPlainText(primary),
      canEditRichText: !chart && canEditRichText(primary),
      borderRadius: computed.borderRadius,
      backgroundColor: computed.backgroundColor,
      styleProfile: {
        target: styleTargetForElement(primary),
        declarations: declarationsForPreset(
          computed,
          styleTargetForElement(primary)
        )
      },
      ...(primary.tagName === "IMG" && primary instanceof HTMLImageElement
        ? { imageSrc: primary.src }
        : {}),
      ...(primary.tagName === "VIDEO" && primary instanceof HTMLVideoElement
        ? { videoSrc: primary.currentSrc || primary.src }
        : {}),
      ...(chart ? { chart } : {})
    };
    if (primary.isContentEditable && this.isTextSelected()) {
      selection.hasTextSelection = true;
    } else if (this.isTextSelected()) {
      selection.hasTextSelection = true;
    }
    // Phase 6: flag chart blocks so the right panel shows config regardless of ECharts loading
    if (primary.hasAttribute("data-hs-chart") && !chart) {
      selection.isChartBlock = true;
    }
    // GrapesJS Symbols detection
    if (primary.hasAttribute("data-hs-symbol")) {
      selection.isSymbol = true;
      selection.symbolId = primary.getAttribute("data-hs-symbol") ?? "";
    }
    selection.responsiveOverrides = this.responsive.rulesFor(primary);
    const component = this.components.describe(primary);
    if (component) selection.component = component;
    const browserSelection = window.getSelection();
    const caretInsidePrimary = Boolean(
      browserSelection?.isCollapsed
      && browserSelection.anchorNode
      && primary.contains(browserSelection.anchorNode)
    );
    // GrapesJS StyleManager: live text formatting state
    if (
      selection.hasTextSelection
      || primary.isContentEditable
      || caretInsidePrimary
    ) {
      selection.textFormat = {
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        foreColor: this.queryColorState("foreColor"),
        hiliteColor: this.queryColorState("hiliteColor"),
        fontSize: this.queryFontSizeState()
      };
    }
    postToHost({ type: "selection", selection });
  }

  private setSelection(element: HTMLElement | null, additive = false): void {
    if (element !== this.primary) this.savedTextRange = null;
    if (!additive) this.selected.clear();
    if (element) {
      if (additive && this.selected.has(element)) {
        this.selected.delete(element);
        if (this.primary === element) {
          this.primary = this.selectionElements().at(-1) ?? null;
        }
      } else {
        this.selected.add(element);
        this.primary = element;
        if (additive && this.selected.size >= 2) {
          this.replaceSelection(
            this.normalizeObjectSelection(this.selectionElements())
          );
        }
      }
    } else if (!additive) {
      this.primary = null;
    }
    this.emitSelection();
  }

  private enterContentEditable(
    target: HTMLElement,
    caretPoint?: { x: number; y: number },
    persistence?: { target: HTMLElement; beforeHtml: string }
  ): void {
    if (this.contentEditable && this.contentEditable !== target) {
      this.commitContentEditable();
    }
    if (!canEditRichText(target)) {
      this.setSelection(target);
      postToHost({
        type: "notice",
        message: "该对象包含布局或脚本结构，请选择内部文字节点进行编辑"
      });
      return;
    }
    this.setSelection(target);
    this.contentEditable = target;
    this.contentEditableCommitTarget = persistence?.target ?? target;
    this.contentEditableBeforeHtml =
      persistence?.beforeHtml ?? target.innerHTML;
    target.contentEditable = "true";
    target.focus();
    let range = caretPoint
      ? document.caretRangeFromPoint?.(caretPoint.x, caretPoint.y) ?? null
      : null;
    if (!range || !target.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
    } else {
      range.collapse(true);
    }
    const browserSelection = window.getSelection();
    browserSelection?.removeAllRanges();
    browserSelection?.addRange(range);
    postToHost({ type: "notice", message: "正在编辑文字；点击外部保存" });
    target.addEventListener("blur", () => {
      this.commitContentEditable();
    }, { once: true });
  }

  private commitContentEditable(): void {
    if (!this.contentEditable) return;
    const target = this.contentEditable;
    const commitTarget = this.contentEditableCommitTarget ?? target;
    const before = this.contentEditableBeforeHtml ?? commitTarget.innerHTML;
    target.removeAttribute("contenteditable");
    const after = commitTarget.innerHTML;
    this.contentEditable = null;
    this.contentEditableCommitTarget = null;
    this.contentEditableBeforeHtml = null;
    if (after !== before) {
      this.commit({
        type: "text.patchStyle",
        nodeId: idOf(commitTarget),
        before,
        after
      });
    }
    this.emitSelection();
    // Re-select to keep the component selected after blur
    requestAnimationFrame(() => {
      if (target.isConnected && this.selected.size === 0) {
        this.selected.add(target);
        this.primary = target;
        this.emitSelection();
      }
    });
  }

  private commit(payload: CommandPayload): void {
    const componentPayload = this.components.convert(payload);
    for (const converted of this.dynamicNodes.convert(componentPayload)) {
      postToHost({ type: "command", payload: converted });
      // GrapesJS Symbols: propagate changes to other instances
      if (converted.type === "styles.set") {
        this.propagateSymbolChanges(converted.nodes);
      } else if (converted.type === "text.set" || converted.type === "text.patchStyle") {
        this.propagateSymbolText(converted.nodeId, converted.type === "text.patchStyle" ? converted.after : converted.after);
      }
    }
    this.updateOverlay();
  }

  /**
   * GrapesJS-style in-place undo/redo. Applies a command (the inverse on
   * undo, the forward on redo) to the live DOM without reloading the iframe.
   * The host has already updated SQLite; this method keeps the visible
   * canvas in sync so the user sees the change instantly, with no flicker,
   * no scroll jump, and no loss of in-progress text selection.
   */
  private applyCommandInPlace(payload: CommandPayload): void {
    // Exit contentEditable so the user isn't typing while the DOM is mutated.
    if (this.contentEditable) {
      this.commitContentEditable();
    }
    try {
      switch (payload.type) {
        case "styles.set":
          for (const change of payload.nodes) {
            const element = this.findNodeById(change.nodeId);
            if (!element) continue;
            for (const decl of change.after) {
              element.style.setProperty(decl.property, decl.value, decl.priority);
            }
          }
          break;
        case "text.set": {
          const element = this.findNodeById(payload.nodeId);
          if (element) element.textContent = payload.after;
          break;
        }
        case "text.patchStyle": {
          const element = this.findNodeById(payload.nodeId);
          if (element) element.innerHTML = payload.after;
          // The patched element may have been a dynamic node whose data
          // lives on the anchor. The inverse stored in the database is
          // already converted; for a pure persistent node, this is enough.
          break;
        }
        case "attribute.set": {
          const element = this.findNodeById(payload.nodeId);
          if (!element) break;
          if (payload.after === null) {
            element.removeAttribute(payload.name);
          } else {
            element.setAttribute(payload.name, payload.after);
          }
          // If we just replaced the dynamic-patch manifest, re-apply it.
          if (payload.name === DYNAMIC_PATCH_ATTRIBUTE) {
            // A manifest describes edits to DOM that the page script owns.
            // Replaying the new manifest can apply forward changes, but it
            // cannot reconstruct properties/nodes removed by an undo. Reload
            // the isolated canvas so the page script recreates its baseline,
            // then DynamicNodeManager replays exactly the target manifest.
            window.location.reload();
            return;
          }
          // Chart manifest updates: refresh chart overrides.
          if (payload.name === "data-hs-chart-manifest" || element.tagName === "SCRIPT") {
            this.charts.restoreOverrides();
          }
          break;
        }
        case "node.insert": {
          const parent = this.findNodeById(payload.parentId);
          if (!parent) break;
          const newNode = document.createElement(payload.node.tagName);
          newNode.setAttribute("data-hs-id", payload.node.id);
          for (const [name, value] of Object.entries(payload.node.attributes)) {
            newNode.setAttribute(name, value);
          }
          newNode.innerHTML = payload.node.text;
          const ref = parent.children.item(payload.index);
          if (ref) parent.insertBefore(newNode, ref);
          else parent.appendChild(newNode);
          break;
        }
        case "node.delete": {
          const element = this.findNodeById(payload.nodeId);
          element?.remove();
          break;
        }
        case "node.move": {
          const parent = this.findNodeById(payload.parentId);
          const node = this.findNodeById(payload.nodeId);
          if (!parent || !node || node.parentElement !== parent) break;
          node.remove();
          const ref = parent.children.item(payload.afterIndex);
          if (ref) parent.insertBefore(node, ref);
          else parent.appendChild(node);
          break;
        }
        case "chart.patch":
          // Undo/redo updates the authoritative file outside this iframe.
          // Apply the command payload directly instead of replaying the
          // registry's stale in-memory manifest.
          this.charts.applyOverride(payload.chartKey, payload.after);
          break;
        case "document.patch":
          let dynamicManifestChanged = false;
          let chartBlockChanged = false;
          for (const change of payload.attributes) {
            const element = this.findNodeById(change.nodeId);
            if (!element) continue;
            if (change.after === null) element.removeAttribute(change.name);
            else element.setAttribute(change.name, change.after);
            if (change.name === DYNAMIC_PATCH_ATTRIBUTE) {
              dynamicManifestChanged = true;
            }
            if (
              change.name === "data-hs-chart"
              || change.name === "data-hs-chart-data"
            ) {
              chartBlockChanged = true;
            }
          }
          for (const change of payload.managedStyles) {
            const selector =
              `style[data-hs-managed-style="${CSS.escape(change.styleId)}"]`;
            const existing =
              document.querySelector<HTMLStyleElement>(selector);
            if (change.after === null) {
              existing?.remove();
              continue;
            }
            const style = existing ?? document.createElement("style");
            style.dataset.hsManagedStyle = change.styleId;
            style.textContent = change.after;
            if (!existing) {
              (document.head ?? document.documentElement).appendChild(style);
            }
          }
          if (dynamicManifestChanged || chartBlockChanged) {
            window.location.reload();
            return;
          }
          break;
        case "component.update":
          for (const change of payload.texts) {
            const element = this.findNodeById(change.nodeId);
            if (element) element.textContent = change.after;
          }
          for (const change of payload.html) {
            const element = this.findNodeById(change.nodeId);
            if (element) element.innerHTML = change.after;
          }
          for (const change of payload.styles) {
            const element = this.findNodeById(change.nodeId);
            if (!element) continue;
            for (const declaration of change.after) {
              if (!declaration.existed) {
                element.style.removeProperty(declaration.property);
              } else {
                element.style.setProperty(
                  declaration.property,
                  declaration.value,
                  declaration.priority
                );
              }
            }
          }
          for (const change of payload.attributes) {
            const element = this.findNodeById(change.nodeId);
            if (!element) continue;
            if (change.after === null) element.removeAttribute(change.name);
            else element.setAttribute(change.name, change.after);
          }
          break;
        case "watermarks.set":
          this.watermarks.applyFromHistory(payload.after);
          break;
      }
    } catch (error) {
      // The undo/redo must NEVER freeze the editor. If anything goes
      // wrong, log and let the user re-trigger; we deliberately swallow
      // exceptions here so a malformed command doesn't kill the runtime.
      console.error("[editor-runtime] applyCommandInPlace failed:", error, payload);
    }
    // After undo/redo, if the previously-selected element is gone or has
    // shrunk to 0×0 (e.g. italic was removed and left empty content), clear
    // the stale selection to prevent a "floating box" stuck on screen.
    if (this.primary && (!this.primary.isConnected || this.primary.getBoundingClientRect().width === 0)) {
      this.setSelection(null);
    }
    this.updateOverlay();
    this.emitSelection();
  }

  private findNodeById(nodeId: string): HTMLElement | null {
    if (!nodeId) return null;
    if (nodeId === ROOT_NODE_ID) return document.body;
    return document.querySelector<HTMLElement>(
      `[data-hs-id="${CSS.escape(nodeId)}"]`
    );
  }

  private locateNode(nodeId: string): void {
    const target = this.findNodeById(nodeId);
    if (!target) {
      postToHost({ type: "notice", message: "未找到对应元素，文档结构可能已变化" });
      return;
    }
    this.commitContentEditable();
    if (this.imageSlotSelectionMode) {
      this.imageSlotSelectionMode = false;
      this.renderImageSlotOverlays();
      this.emitImageSlotSelection();
    }
    this.setSelection(target);
    target.scrollIntoView({
      behavior: "auto",
      block: "center",
      inline: "center"
    });
    target.classList.remove("hs-locate-flash");
    void target.offsetWidth;
    target.classList.add("hs-locate-flash");
    window.setTimeout(() => {
      target.classList.remove("hs-locate-flash");
    }, 1600);
    window.requestAnimationFrame(() => {
      this.updateOverlay();
      this.emitSelection();
    });
  }

  private onClick(event: MouseEvent): void {
    // If the mouse was dragged, ignore this click — drag is the real intent
    if (this.lastMouseWasDrag) {
      this.lastMouseWasDrag = false;
      return;
    }
    // Click on a resize handle — no action
    if (this.overlay.isResizeHandle(event.target)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (this.imageSlotSelectionMode || event.altKey) {
      if (event.altKey) this.refreshImageSlotCandidates();
      const candidate = this.findImageSlotCandidate(target);
      if (candidate) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.toggleImageSlotCandidate(candidate);
        this.renderImageSlotOverlays();
        this.emitImageSlotSelection();
        if (event.altKey && !this.imageSlotSelectionMode) {
          postToHost({
            type: "notice",
            message: `已选择 ${this.selectedImageSlots.length} 个图片槽；按 Alt + 单击继续选择或取消`
          });
        }
      } else if (event.altKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        postToHost({ type: "notice", message: "该位置未识别为图片槽" });
      }
      return;
    }

    // Pending image placement → click inserts image (preventDefault so browser doesn't swallow it)
    if (this.pendingImagePath) {
      event.preventDefault();
      const placement = placeImage(this.pendingImagePath, target, event);
      this.pendingImagePath = null;
      this.commit(placement.command);
      this.setSelection(placement.element);
      postToHost({ type: "notice", message: "图片已插入" });
      return;
    }

    // Click inside the contentEditable → let browser handle caret
    if (this.contentEditable && this.contentEditable.contains(target)) return;

    // Exit text-edit mode when clicking outside
    this.commitContentEditable();

    // Select or deselect
    const selectable = this.charts.find(target)?.element ?? selectionFor(target);
    if (!selectable) {
      this.setSelection(null);
      return;
    }
    if (this.formatPainterDeclarations) {
      event.preventDefault();
      event.stopPropagation();
      this.applyFormatPainter(selectable);
      return;
    }
    this.setSelection(selectable, event.shiftKey || event.ctrlKey || event.metaKey);
  }

  private onWatermarkActivation(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const watermark = target?.closest<HTMLElement>(
      "[data-hs-watermark-id]"
    );
    if (!watermark) return;
    this.lastMouseWasDrag = false;
    event.preventDefault();
    event.stopImmediatePropagation();
    postToHost({
      type: "watermark-selected",
      watermarkId: watermark.getAttribute("data-hs-watermark-id") ?? ""
    });
  }

  private onDoubleClick(event: MouseEvent): void {
    if (this.imageSlotSelectionMode || event.altKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const eventTarget = event.target instanceof Element ? event.target : null;
    if (this.contentEditable && eventTarget && this.contentEditable.contains(eventTarget)) {
      // Once text editing is active, preserve the browser's native double-click
      // behavior so a second double-click selects the word under the pointer.
      return;
    }
    const chartHandle = this.charts.find(
      event.target instanceof Element ? event.target : null
    );
    if (chartHandle) return;
    let target = richTextContainerFor(eventTarget);
    let persistence:
      | { target: HTMLElement; beforeHtml: string }
      | undefined;
    if (!target && eventTarget instanceof HTMLElement) {
      const wrapped = this.wrapDirectTextRunAtPoint(eventTarget, {
        x: event.clientX,
        y: event.clientY
      });
      target = wrapped?.target ?? null;
      persistence = wrapped?.persistence;
    }
    if (!target || target.tagName === "IMG") return;
    event.preventDefault();
    event.stopPropagation();
    this.pointerDown = null;
    // First double-click enters text editing with a caret at the pointer.
    this.enterContentEditable(
      target,
      { x: event.clientX, y: event.clientY },
      persistence
    );
  }

  private wrapDirectTextRunAtPoint(
    eventTarget: HTMLElement,
    point: { x: number; y: number }
  ): {
    target: HTMLElement;
    persistence: { target: HTMLElement; beforeHtml: string };
  } | null {
    const range = document.caretRangeFromPoint?.(point.x, point.y) ?? null;
    const startNode = range?.startContainer;
    const parent = startNode?.nodeType === Node.TEXT_NODE
      ? startNode.parentElement
      : eventTarget;
    if (
      !(parent instanceof HTMLElement)
      || parent === document.body
      || !idOf(parent)
      || parent.matches(
        "script,style,svg,table,thead,tbody,tfoot,tr,ul,ol,select,option"
      )
      || parent.querySelector("script,canvas,iframe")
    ) {
      return null;
    }
    const nodes = [...parent.childNodes];
    const startIndex = startNode && startNode.parentNode === parent
      ? nodes.indexOf(startNode as ChildNode)
      : -1;
    if (startIndex < 0) return null;
    const isInlineNode = (node: ChildNode): boolean =>
      node.nodeType === Node.TEXT_NODE
      || (
        node instanceof HTMLElement
        && !node.matches(
          "address,article,aside,blockquote,canvas,div,dl,fieldset,figure,"
          + "footer,form,header,hr,iframe,main,nav,ol,section,table,ul,video"
        )
      );
    let first = startIndex;
    let last = startIndex;
    while (first > 0 && isInlineNode(nodes[first - 1]!)) first -= 1;
    while (last < nodes.length - 1 && isInlineNode(nodes[last + 1]!)) last += 1;
    const run = nodes.slice(first, last + 1);
    if (!run.some((node) =>
      node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())
    )) {
      return null;
    }
    const beforeHtml = parent.innerHTML;
    const wrapper = document.createElement("span");
    wrapper.setAttribute("data-hs-id", `node_${crypto.randomUUID()}`);
    wrapper.setAttribute("data-hs-text-run", "");
    parent.insertBefore(wrapper, run[0] ?? null);
    for (const node of run) wrapper.appendChild(node);
    return {
      target: wrapper,
      persistence: { target: parent, beforeHtml }
    };
  }

  private onContextMenu(event: MouseEvent): void {
    if (this.imageSlotSelectionMode) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-hs-id]")
      : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    this.setSelection(target);
    postToHost({
      type: "context-menu",
      nodeId: idOf(target),
      posX: event.clientX,
      posY: event.clientY
    });
  }

  private hoveredEl: HTMLElement | null = null;

  private onHover(event: MouseEvent): void {
    if (this.imageSlotSelectionMode) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-hs-watermark-id]")) return;
    const el = target.closest<HTMLElement>("[data-hs-id]");
    if (!el || el === this.hoveredEl || el.isContentEditable) return;
    if (el.tagName === "BODY" || el.tagName === "HTML") return;
    this.hoveredEl = el;
    el.classList.add("hs-hover-outline");
  }

  private onHoverEnd(event: MouseEvent): void {
    if (!this.hoveredEl) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && this.hoveredEl.contains(target)) return;
    this.hoveredEl.classList.remove("hs-hover-outline");
    this.hoveredEl = null;
  }

  private onMouseDown(event: MouseEvent): void {
    if (this.imageSlotSelectionMode || event.altKey) {
      this.lastMouseWasDrag = false;
      this.pointerDown = null;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    this.lastMouseWasDrag = false;
    // 0. Always tell the host to dismiss the floating text toolbar on any
    // mousedown inside the canvas. The text selection is about to be
    // replaced (or there is none) and the toolbar should disappear.
    this.reportFloatToolbar(false, 0, 0);
    // 1. Resize handle
    const resizeDir = this.overlay.isResizeHandle(event.target);
    if (resizeDir && this.primary) {
      event.preventDefault();
      const rect = this.primary.getBoundingClientRect();
      const computed = getComputedStyle(this.primary);
      const isAbsolute = ["absolute", "fixed"].includes(computed.position);
      this.drag = {
        mode: "resize",
        element: this.primary,
        direction: resizeDir,
        startX: event.clientX,
        startY: event.clientY,
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top,
        aspectRatio: event.shiftKey ? rect.width / rect.height : null,
        isAbsolute,
        beforeWidth: inlineDeclaration(this.primary, "width"),
        beforeHeight: inlineDeclaration(this.primary, "height"),
        ...(isAbsolute ? {
          beforeLeft: inlineDeclaration(this.primary, "left"),
          beforeTop: inlineDeclaration(this.primary, "top")
        } : {})
      };
      // Clear pointer-down so click handler ignores this
      this.pointerDown = null;
      return;
    }

    // 2. Track pointer for click/drag distinction
    const target = event.target instanceof HTMLElement ? event.target : document.documentElement;
    this.pointerDown = { x: event.clientX, y: event.clientY, target, dragMoved: false };

    // 3. Drag initiation for non-resize mousedown
    const eventTarget = event.target instanceof Element ? event.target : null;
    if (!eventTarget) return;
    const element = this.charts.find(eventTarget)?.element ?? selectionFor(eventTarget);
    if (!element || element.isContentEditable) return;

    // Prevent native drag on images/links
    const tag = element.tagName.toLowerCase();
    if (tag === "img" || tag === "a" || element.draggable) {
      event.preventDefault();
    }

    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (additive) return;
    if (!this.selected.has(element)) this.setSelection(element);

    const computed = getComputedStyle(element);
    if (
      ["absolute", "fixed"].includes(computed.position)
      || element.style.getPropertyValue(FREE_ORIGIN_PROPERTY) !== ""
    ) {
      const movable = this.selectionElements().filter(c =>
        ["absolute", "fixed"].includes(getComputedStyle(c).position)
        || c.style.getPropertyValue(FREE_ORIGIN_PROPERTY) !== ""
      );
      this.drag = {
        mode: "pending",
        kind: "free",
        element,
        elements: movable.length > 0 ? movable : [element],
        pointerId: event.button,
        startX: event.clientX,
        startY: event.clientY
      };
    } else if (isRepeatedComponent(element)) {
      this.drag = {
        mode: "pending",
        kind: "flow",
        element,
        elements: [element],
        pointerId: event.button,
        startX: event.clientX,
        startY: event.clientY
      };
    }
  }

  private onMouseMove(event: MouseEvent): void {
    // Track click/drag distance
    if (this.pointerDown) {
      const dx = event.clientX - this.pointerDown.x;
      const dy = event.clientY - this.pointerDown.y;
      if (Math.hypot(dx, dy) > 4) {
        this.pointerDown.dragMoved = true;
        this.lastMouseWasDrag = true;
      }
    }

    // Drag state handling
    if (!this.drag) return;
    if (this.drag.mode === "pending") {
      const dist = Math.hypot(event.clientX - this.drag.startX, event.clientY - this.drag.startY);
      if (dist < 5) return;
      event.preventDefault();
      const pending = this.drag;
      if (pending.kind === "flow") {
        this.drag = beginFlowDrag(pending.element, pending.pointerId);
        updateFlowDrag(this.drag, event.clientX, event.clientY);
      } else {
        this.drag = beginFreeDrag(pending.elements, event.clientX, event.clientY, pending.pointerId);
        updateFreeDrag(this.drag, event.clientX, event.clientY);
      }
      this.updateOverlay();
      return;
    }

    if (this.drag.mode === "flow") {
      if (updateFlowDrag(this.drag, event.clientX, event.clientY)) this.updateOverlay();
      return;
    }
    if (this.drag.mode === "free") {
      updateFreeDrag(this.drag, event.clientX, event.clientY);
      this.updateOverlay();
      return;
    }

    // Resize — compute new dimensions from 8-direction handles
    const resize = this.drag;
    const dx = event.clientX - resize.startX;
    const dy = event.clientY - resize.startY;
    const { width: newW, height: newH } = computeResizeDimensions(
      resize.direction, resize.width, resize.height, dx, dy, resize.aspectRatio
    );
    resize.element.style.width = `${newW}px`;
    resize.element.style.height = `${newH}px`;
    if (resize.isAbsolute) {
      const pos = computeResizePosition(
        resize.direction, resize.width, resize.height, newW, newH, resize.left, resize.top
      );
      if (pos.left !== undefined) resize.element.style.left = `${pos.left}px`;
      if (pos.top !== undefined) resize.element.style.top = `${pos.top}px`;
    }
    this.updateOverlay();
  }

  private onMouseUp(_event: MouseEvent): void {
    // Clear pointerDown for click/drag tracking
    this.pointerDown = null;

    if (!this.drag) return;
    const drag = this.drag;
    this.drag = null;

    if (drag.mode === "pending") return;

    if (drag.mode === "flow") {
      const cmd = finishFlowDrag(drag);
      if (cmd) {
        this.commit(cmd);
        postToHost({ type: "notice", message: "卡片顺序已更新" });
      }
      this.emitSelection();
      return;
    }

    if (drag.mode === "free") {
      this.commit(finishFreeDrag(drag));
      this.emitSelection();
      return;
    }

    // Resize commit
    const node = {
      nodeId: idOf(drag.element),
      before: [drag.beforeWidth, drag.beforeHeight] as StyleDeclaration[],
      after: [
        explicitDeclaration("width", drag.element.style.width),
        explicitDeclaration("height", drag.element.style.height)
      ] as StyleDeclaration[]
    };
    if (drag.isAbsolute) {
      if (drag.beforeLeft) node.before.push(drag.beforeLeft);
      if (drag.beforeTop) node.before.push(drag.beforeTop);
      node.after.push(
        explicitDeclaration("left", drag.element.style.left),
        explicitDeclaration("top", drag.element.style.top)
      );
    }
    this.commit({ type: "styles.set", nodes: [node] });
    this.emitSelection();
  }

  private onKeyDown(event: KeyboardEvent): void {
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const typing = this.contentEditable
      || event.target instanceof HTMLInputElement
      || event.target instanceof HTMLTextAreaElement
      || (
        event.target instanceof HTMLElement
        && event.target.isContentEditable
      );
    if (ctrl && !typing && (key === "z" || key === "y")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      postToHost({
        type: "history-request",
        direction: key === "y" || event.shiftKey ? "redo" : "undo"
      });
      return;
    }
    if (this.imageSlotSelectionMode && event.key === "Escape") {
      event.preventDefault();
      this.clearImageSlotSelection();
      postToHost({ type: "notice", message: "已退出图片槽选择" });
      return;
    }
    // Escape: exit text edit, or deselect
    if (event.key === "Escape") {
      if (this.formatPainterDeclarations) {
        this.cancelFormatPainter();
        event.preventDefault();
        return;
      }
      if (this.contentEditable) {
        this.commitContentEditable();
        event.preventDefault();
        return;
      }
      if (this.selected.size > 0) {
        this.setSelection(null);
        event.preventDefault();
        return;
      }
      return;
    }
    // Don't intercept Delete when typing in contentEditable
    if (event.key === "Delete" || event.key === "Backspace") {
      if (this.contentEditable || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (this.selected.size === 0) return;
      event.preventDefault();
      this.deleteSelected();
      return;
    }
  }

  private onHostMessage(event: MessageEvent<unknown>): void {
    if (event.source !== window.parent || !isHostMessage(event.data)) return;
    const message = event.data;
    switch (message.action) {
      case "ping":
        postToHost({ type: "ready" });
        break;
      case "set-style":
        this.setStyle(message.declarations);
        break;
      case "preview-style":
        this.previewStyle(message.declarations);
        break;
      case "commit-style":
        this.commitStylePreview(message.declarations);
        break;
      case "cancel-style-preview":
        this.cancelStylePreview();
        break;
      case "request-style-presets":
        this.reportStylePresets();
        break;
      case "convert-free":
        this.convertToLocalFree();
        break;
      case "toggle-free":
        this.toggleFreeMovement();
        break;
      case "set-text":
        this.setText(message.text);
        break;
      case "preview-text":
        this.previewText(message.text);
        break;
      case "commit-text":
        this.commitTextPreview(message.text);
        break;
      case "align":
        this.alignSelection(message.alignment);
        break;
      case "clear-selection":
        this.setSelection(null);
        break;
      case "chart-patch":
        this.patchChart(message.patch);
        break;
      case "convert-svg-chart":
        this.convertSvgChart();
        break;
      case "image":
        this.acceptImage(message.path);
        break;
      case "images":
        this.acceptImages(message.images);
        break;
      case "select-image-slots":
        this.selectImageSlots(message.mode);
        break;
      case "video":
        this.acceptVideoAsset(message.path, message.title);
        break;
      case "save-editor-state":
        this.reportState();
        break;
      case "restore-editor-state":
        this.restoreState(message.state);
        break;
      case "request-copy":
        this.copySelected();
        break;
      case "paste":
        this.pasteClipboard(message.clipboardData);
        break;
      case "text-style":
        this.applyTextStyle(message.property, message.value);
        break;
      case "preview-text-style":
        this.previewTextStyle(message.property, message.value);
        break;
      case "commit-text-style":
        this.commitTextStylePreview(message.property, message.value);
        break;
      case "call-delete":
        this.deleteSelected();
        break;
      case "apply-command":
        this.applyCommandInPlace(message.payload);
        break;
      case "clone-selected":
        this.cloneSelected();
        break;
      case "adjust-zindex":
        this.adjustZIndex(message.delta);
        break;
      case "request-layers":
        this.reportLayers();
        break;
      case "request-source":
        this.reportSource();
        break;
      case "materialize-document":
        void this.materializeDocument();
        break;
      case "change-chart-type":
        this.changeChartType(message.chartType);
        break;
      case "import-csv-data":
        this.importCsvData();
        break;
      case "import-video":
        this.acceptVideo();
        break;
      case "set-attribute":
        this.setAttribute(message.name, message.value);
        break;
      case "nudge":
        this.nudge(message.dx, message.dy);
        break;
      case "select-all-in-container":
        this.selectAllInContainer();
        break;
      case "edit-selected":
        if (this.primary && this.primary.tagName !== "IMG") {
          this.enterContentEditable(
            richTextContainerFor(this.primary) ?? this.primary
          );
        }
        break;
      case "toggle-symbol":
        this.toggleSymbol();
        break;
      case "format-painter-start":
        this.startFormatPainter();
        break;
      case "format-painter-cancel":
        this.cancelFormatPainter();
        break;
      case "responsive-style":
        if (!this.primary) break;
        try {
          this.responsive.apply(
            this.primary,
            message.breakpoint,
            message.declarations
          );
          this.emitSelection();
        } catch (error) {
          postToHost({
            type: "notice",
            message: error instanceof Error ? error.message : "断点样式保存失败"
          });
        }
        break;
      case "preview-responsive-style":
        if (!this.primary) break;
        try {
          this.responsive.preview(
            this.primary,
            message.breakpoint,
            message.declarations
          );
          this.updateOverlay();
        } catch (error) {
          postToHost({
            type: "notice",
            message: error instanceof Error ? error.message : "断点样式预览失败"
          });
        }
        break;
      case "commit-responsive-style":
        if (!this.primary) break;
        try {
          this.responsive.commitPreview(
            this.primary,
            message.breakpoint,
            message.declarations
          );
          this.emitSelection();
        } catch (error) {
          postToHost({
            type: "notice",
            message: error instanceof Error ? error.message : "断点样式保存失败"
          });
        }
        break;
      case "responsive-visibility":
        if (!this.primary) break;
        try {
          this.responsive.apply(
            this.primary,
            message.breakpoint,
            [{ property: "display", value: message.visible ? "" : "none" }]
          );
          this.emitSelection();
        } catch (error) {
          postToHost({
            type: "notice",
            message: error instanceof Error ? error.message : "断点可见性保存失败"
          });
        }
        break;
      case "request-responsive-audit":
        void this.responsive.audit().then((report) => {
          postToHost({
            type: "responsive-audit",
            report,
            importedMediaQueries: this.responsive.importedMediaQueries()
          });
        });
        break;
      case "preview-theme":
        this.theme.preview(message.css, message.mode);
        break;
      case "commit-theme":
        this.theme.commitPreview(message.css, message.mode);
        break;
      case "cancel-theme-preview":
        this.theme.cancelPreview();
        break;
      case "sync-watermarks":
        this.watermarks.sync(message.settings);
        break;
      case "preview-watermarks":
        this.watermarks.preview(message.settings);
        break;
      case "commit-watermarks":
        this.watermarks.commit(message.settings);
        break;
      case "cancel-watermark-preview":
        this.watermarks.cancelPreview();
        break;
      case "request-watermark-candidates":
        postToHost({
          type: "watermark-candidates",
          candidates: this.watermarks.detectLegacyCandidates()
        });
        break;
      case "search-document":
        postToHost({
          type: "document-navigation",
          navigation: this.navigator.search(message.query, message.filter)
        });
        break;
      case "locate-node":
        this.locateNode(message.nodeId);
        break;
      case "component-create":
        if (!this.primary) break;
        try {
          this.components.create(this.primary, message.name);
          this.emitSelection();
          postToHost({ type: "notice", message: "已创建主组件" });
        } catch (error) {
          postToHost({
            type: "notice",
            message: error instanceof Error ? error.message : "组件创建失败"
          });
        }
        break;
      case "component-duplicate":
        if (!this.primary) break;
        try {
          const instance = this.components.duplicate(this.primary);
          this.setSelection(instance);
          postToHost({ type: "notice", message: "已创建组件实例" });
        } catch (error) {
          postToHost({
            type: "notice",
            message: error instanceof Error ? error.message : "实例创建失败"
          });
        }
        break;
      case "component-detach":
        if (!this.primary) break;
        try {
          this.components.detach(this.primary);
          this.emitSelection();
          postToHost({ type: "notice", message: "实例已分离为普通元素" });
        } catch (error) {
          postToHost({
            type: "notice",
            message: error instanceof Error ? error.message : "组件分离失败"
          });
        }
        break;
      case "component-reset-field":
        if (!this.primary) break;
        try {
          this.components.resetCurrentField(this.primary);
          this.emitSelection();
          postToHost({ type: "notice", message: "已恢复主组件字段" });
        } catch (error) {
          postToHost({
            type: "notice",
            message: error instanceof Error ? error.message : "字段恢复失败"
          });
        }
        break;
      case "select-next-sibling":
        this.selectNextSibling(message.forward);
        break;
      case "insert-block":
        this.insertBlock(message.blockType, message.placement);
        break;
    }
  }

  private patchChart(patch: ChartPatch): void {
    if (!this.primary) return;

    // Path A: user-inserted chart block (data-hs-chart) — safely re-render
    if (this.primary.hasAttribute("data-hs-chart")) {
      try {
        const raw = this.primary.dataset.hsChartData ?? "{}";
        const before: ChartBlockData = { ...getDefaultChartData(), ...JSON.parse(raw) };
        const config: ChartBlockData = { ...before };
        // Merge the patch data into config
        if (patch.title !== undefined) config.title = patch.title;
        if (patch.legendVisible !== undefined) {
          config.legendVisible = patch.legendVisible;
        }
        if (patch.primaryColor !== undefined) config.color = patch.primaryColor;
        if (patch.data) {
          if (patch.data.labels) config.xAxis = patch.data.labels as string[];
          config.series = patch.data.series.map((series, index) => {
            const color = series.color ?? config.series[index]?.color;
            return {
              name: series.name
                ?? config.series[index]?.name
                ?? `系列 ${index + 1}`,
              data: series.data as number[],
              ...(color ? { color } : {})
            };
          });
        }
        this.primary.dataset.hsChartData = JSON.stringify(config);
        // Get existing ECharts instance, NEVER call init() again
        const echarts = (window as unknown as { echarts?: { getInstanceByDom: (el: HTMLElement) => EChartInstance | undefined } }).echarts;
        const inst = echarts?.getInstanceByDom(this.primary);
        if (inst) {
          // Update in place — safe, doesn't touch DOM
          inst.setOption(buildEChartsOption(config), { notMerge: false });
          setTimeout(() => inst.resize(), 50);
          // Re-attach drag circles if line/area
          if (config.type === "line" || config.type === "area") {
            const eChartsGlobal = (window as unknown as {
              echarts?: { util?: { map: <T,R>(a: T[], f: (v: T, i: number) => R) => R[] } };
            }).echarts;
            if (eChartsGlobal?.util) {
              this.refreshChartDragPoints(this.primary, inst, config, eChartsGlobal);
            }
          }
        } else {
          // No instance — fall back to init
          this.initChartElements();
        }
        // Persist the change
        const chartKey = `hs-chart:${idOf(this.primary)}`;
        this.commit({
          type: "chart.patch",
          chartKey,
          before: before as unknown as ChartPatch,
          after: config as unknown as ChartPatch
        });
        this.emitSelection();
      } catch (err) {
        console.error("[patchChart hs-chart]", err);
      }
      return;
    }

    // Path B: existing chart-manifest charts (imported HTML)
    const handle = this.charts.findByElement(this.primary)
      ?? this.charts.find(this.primary);
    if (!handle) return;
    const chartKey = this.charts.keyOf(handle);
    const before = this.charts.readPatch(handle);
    const after = { ...before, ...patch };
    this.charts.remember(chartKey, after);
    handle.apply(patch);
    handle.resize();
    this.commit({
      type: "chart.patch",
      chartKey,
      before,
      after
    });
    this.emitSelection();
  }

  private convertSvgChart(): void {
    if (!this.primary) return;
    const handle = this.charts.findByElement(this.primary)
      ?? this.charts.find(this.primary);
    if (!handle) {
      postToHost({ type: "notice", message: "请先选中一个 SVG 图表" });
      return;
    }
    const snapshot = this.charts.snapshot(handle);
    if (
      snapshot.engine !== "svg"
      || !snapshot.conversion?.supported
      || !snapshot.data
      || !snapshot.conversion.suggestedType
    ) {
      postToHost({
        type: "notice",
        message: snapshot.conversion?.reason ?? "当前图表无法可靠恢复数据"
      });
      return;
    }

    const nodeId = idOf(handle.element);
    if (isDynamicId(nodeId)) {
      postToHost({
        type: "notice",
        message: "这个图表缺少可持久化容器，暂时不能转换"
      });
      return;
    }
    const labels = (snapshot.data.labels ?? []).map(String);
    const series = snapshot.data.series.map((source, index) => ({
      name: source.name ?? `系列 ${index + 1}`,
      data: source.data.map(Number),
      ...(source.color ? { color: source.color } : {})
    }));
    if (
      labels.length === 0
      || series.length === 0
      || series.some((item) =>
        item.data.length !== labels.length
        || item.data.some((value) => !Number.isFinite(value))
      )
    ) {
      postToHost({
        type: "notice",
        message: "恢复出的数据不完整，已保留原始 SVG"
      });
      return;
    }

    const config: ChartBlockData = {
      type: snapshot.conversion.suggestedType,
      xAxis: labels,
      series,
      color: snapshot.primaryColor ?? series[0]?.color ?? "#4f7cff",
      title: "",
      legendVisible: true,
      ...(snapshot.conversion.style
        ? { style: snapshot.conversion.style }
        : {})
    };
    const element = handle.element;
    const beforeChart = element.getAttribute("data-hs-chart");
    const beforeData = element.getAttribute("data-hs-chart-data");
    const afterChart = `echarts-${config.type}`;
    const afterData = JSON.stringify(config);
    element.setAttribute("data-hs-chart", afterChart);
    element.setAttribute("data-hs-chart-data", afterData);
    element.innerHTML = "";
    (element as HTMLElement & { _hsChartReady?: boolean })._hsChartReady = false;
    this.commit({
      type: "document.patch",
      attributes: [
        {
          nodeId,
          name: "data-hs-chart",
          before: beforeChart,
          after: afterChart
        },
        {
          nodeId,
          name: "data-hs-chart-data",
          before: beforeData,
          after: afterData
        }
      ],
      managedStyles: []
    });
    this.initChartElements();
    this.setSelection(element);
    postToHost({
      type: "notice",
      message: `已转换为可编辑${config.type === "pie" ? "饼图" : "折线图"}，可随时撤销恢复原图`
    });
  }

  private setStyle(
    declarations: Array<Pick<StyleDeclaration, "property" | "value" | "priority">>
  ): void {
    const elements = this.selectionElements();
    if (elements.length === 0) return;
    const nodes = elements.map((element) => {
      const before = declarations.map(({ property }) =>
        inlineDeclaration(element, property)
      );
      for (const declaration of declarations) {
        element.style.setProperty(
          declaration.property,
          declaration.value,
          declaration.priority
        );
      }
      return {
        nodeId: idOf(element),
        before,
        after: declarations.map(({ property, value, priority }) =>
          explicitDeclaration(property, value, priority)
        )
      };
    });
    this.commit({ type: "styles.set", nodes });
    this.emitSelection();
  }

  private startFormatPainter(): void {
    if (!this.primary) {
      postToHost({ type: "notice", message: "请先选择要复制格式的元素" });
      return;
    }
    const computed = getComputedStyle(this.primary);
    const properties = [
      "color",
      "background-color",
      "font-family",
      "font-size",
      "font-weight",
      "font-style",
      "text-decoration",
      "text-align",
      "line-height",
      "letter-spacing",
      "border",
      "border-radius",
      "padding"
    ] as const;
    this.formatPainterDeclarations = properties.map((property) =>
      explicitDeclaration(
        property,
        computed.getPropertyValue(property),
        computed.getPropertyPriority(property) === "important"
          ? "important"
          : ""
      )
    );
    postToHost({ type: "format-painter-state", active: true });
    postToHost({ type: "notice", message: "格式刷已启用，请点击目标元素；Esc 取消" });
  }

  private cancelFormatPainter(): void {
    this.formatPainterDeclarations = null;
    postToHost({ type: "format-painter-state", active: false });
    postToHost({ type: "notice", message: "格式刷已取消" });
  }

  private applyFormatPainter(target: HTMLElement): void {
    const declarations = this.formatPainterDeclarations;
    if (!declarations) return;
    const before = declarations.map(({ property }) =>
      inlineDeclaration(target, property)
    );
    for (const declaration of declarations) {
      target.style.setProperty(
        declaration.property,
        declaration.value,
        declaration.priority
      );
    }
    const after = declarations.map(({ property }) =>
      inlineDeclaration(target, property)
    );
    this.commit({
      type: "styles.set",
      nodes: [{ nodeId: idOf(target), before, after }]
    });
    this.formatPainterDeclarations = null;
    postToHost({ type: "format-painter-state", active: false });
    this.setSelection(target);
    postToHost({ type: "notice", message: "格式已应用" });
  }

  private previewStyle(
    declarations: Array<Pick<StyleDeclaration, "property" | "value" | "priority">>
  ): void {
    const elements = this.selectionElements();
    for (const element of elements) {
      const nodeId = idOf(element);
      for (const declaration of declarations) {
        const key = `${nodeId}\u0000${declaration.property}`;
        if (!this.stylePreviewBefore.has(key)) {
          this.stylePreviewBefore.set(
            key,
            inlineDeclaration(element, declaration.property)
          );
        }
        if (declaration.value === "") {
          element.style.removeProperty(declaration.property);
        } else {
          element.style.setProperty(
            declaration.property,
            declaration.value,
            declaration.priority
          );
        }
      }
    }
    // Preview changes should be visible immediately without emitting a new
    // selection snapshot, which would remount the active form control.
    this.updateOverlay();
  }

  private commitStylePreview(
    declarations: Array<Pick<StyleDeclaration, "property" | "value" | "priority">>
  ): void {
    const elements = this.selectionElements();
    const nodes: Extract<CommandPayload, { type: "styles.set" }>["nodes"] = [];
    for (const element of elements) {
      const nodeId = idOf(element);
      const before: StyleDeclaration[] = [];
      for (const declaration of declarations) {
        const key = `${nodeId}\u0000${declaration.property}`;
        before.push(
          this.stylePreviewBefore.get(key)
            ?? inlineDeclaration(element, declaration.property)
        );
        this.stylePreviewBefore.delete(key);
        if (declaration.value === "") {
          element.style.removeProperty(declaration.property);
        } else {
          element.style.setProperty(
            declaration.property,
            declaration.value,
            declaration.priority
          );
        }
      }
      const after = declarations.map(({ property }) =>
        inlineDeclaration(element, property)
      );
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        nodes.push({ nodeId, before, after });
      }
    }
    if (nodes.length > 0) this.commit({ type: "styles.set", nodes });
    this.emitSelection();
  }

  private cancelStylePreview(): void {
    for (const [key, before] of this.stylePreviewBefore) {
      const separator = key.indexOf("\u0000");
      if (separator < 0) continue;
      const nodeId = key.slice(0, separator);
      const property = key.slice(separator + 1);
      const element = this.findNodeById(nodeId);
      if (!element) continue;
      if (!before.existed || before.value === "") {
        element.style.removeProperty(property);
      } else {
        element.style.setProperty(
          property,
          before.value,
          before.priority
        );
      }
    }
    this.stylePreviewBefore.clear();
    this.updateOverlay();
  }

  private reportStylePresets(): void {
    const grouped = new Map<string, {
      preset: StylePreset;
      count: number;
      firstIndex: number;
    }>();
    const elements = [
      ...document.querySelectorAll<HTMLElement>("body [data-hs-id]")
    ].slice(0, 5_000);
    for (const [index, element] of elements.entries()) {
      if (
        element.closest("[data-hs-overlay]")
        || element.matches("script,style,canvas,svg,video,iframe")
      ) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 12 || rect.height < 8) continue;
      const computed = getComputedStyle(element);
      if (computed.display === "none" || computed.visibility === "hidden") {
        continue;
      }
      const target = styleTargetForElement(element);
      const captured = declarationsForPreset(computed, target);
      const declarations = this.meaningfulPresetDeclarations(
        target,
        captured
      );
      if (declarations.length === 0) continue;
      const signature = `${target}|${presetSignature(declarations)}`;
      const existing = grouped.get(signature);
      if (existing) {
        existing.count += 1;
        existing.preset.usageCount = existing.count;
        continue;
      }
      const category = this.stylePresetCategory(target);
      const sampleText = (element.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 32);
      const preset: StylePreset = {
        id: `document-${target}-${index}-${this.hashPresetSignature(signature)}`,
        name: sampleText
          ? `${category} · ${sampleText.slice(0, 14)}`
          : `${category}样式`,
        category,
        target,
        source: "document",
        declarations,
        ...(sampleText ? { sampleText } : {}),
        usageCount: 1
      };
      grouped.set(signature, { preset, count: 1, firstIndex: index });
    }
    const presets = [...grouped.values()]
      .sort((left, right) =>
        right.count - left.count || left.firstIndex - right.firstIndex
      )
      .slice(0, 48)
      .map(({ preset }) => preset);
    postToHost({ type: "style-presets", presets });
  }

  private meaningfulPresetDeclarations(
    target: StylePresetTarget,
    declarations: StylePreset["declarations"]
  ): StylePreset["declarations"] {
    const defaults = new Set([
      "none",
      "normal",
      "auto",
      "0px",
      "rgba(0, 0, 0, 0)",
      "transparent",
      "1"
    ]);
    if (target === "text") {
      return declarations.filter(({ property, value }) =>
        !(
          ["background-color", "border-left", "border-radius", "padding"]
            .includes(property)
          && defaults.has(value)
        )
      );
    }
    const visualProperties = new Set([
      "background-color",
      "background-image",
      "border",
      "border-radius",
      "box-shadow",
      "filter",
      "object-fit",
      "padding"
    ]);
    const visual = declarations.filter(({ property, value }) => {
      if (!visualProperties.has(property)) return false;
      if (defaults.has(value)) return false;
      if (
        property === "border"
        && (value.startsWith("0px ") || value.includes(" none "))
      ) return false;
      if (property === "padding" && /^0px(?: 0px){0,3}$/.test(value)) {
        return false;
      }
      return true;
    });
    if (visual.length === 0 && !["button", "table"].includes(target)) {
      return [];
    }
    return declarations.filter(({ property, value }) =>
      !defaults.has(value)
      || property === "color"
      || property.startsWith("font-")
    );
  }

  private stylePresetCategory(target: StylePresetTarget): string {
    return {
      text: "文字",
      surface: "卡片",
      image: "图片",
      button: "按钮",
      table: "表格"
    }[target];
  }

  private hashPresetSignature(value: string): string {
    let hash = 2_166_136_261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
    return (hash >>> 0).toString(36);
  }

  private setText(text: string): void {
    if (!this.primary || !canEditPlainText(this.primary)) return;
    const before = this.primary.textContent ?? "";
    if (before === text) return;
    // Replace all text content including child text nodes
    while (this.primary.firstChild) {
      this.primary.removeChild(this.primary.firstChild);
    }
    this.primary.appendChild(document.createTextNode(text));
    this.commit({
      type: "text.set",
      nodeId: idOf(this.primary),
      before,
      after: text
    });
    this.emitSelection();
  }

  private previewText(text: string): void {
    if (!this.primary || !canEditPlainText(this.primary)) return;
    const nodeId = idOf(this.primary);
    if (!this.textPreviewBefore.has(nodeId)) {
      this.textPreviewBefore.set(nodeId, this.primary.textContent ?? "");
    }
    if (this.primary.textContent !== text) {
      this.primary.textContent = text;
      this.updateOverlay();
    }
  }

  private commitTextPreview(text: string): void {
    if (!this.primary || !canEditPlainText(this.primary)) return;
    const nodeId = idOf(this.primary);
    const before = this.textPreviewBefore.get(nodeId)
      ?? this.primary.textContent
      ?? "";
    this.textPreviewBefore.delete(nodeId);
    if (this.primary.textContent !== text) this.primary.textContent = text;
    if (before !== text) {
      this.commit({
        type: "text.set",
        nodeId,
        before,
        after: text
      });
    }
    this.emitSelection();
  }

  private freeGeometryChanges(
    elements: HTMLElement[]
  ): Extract<CommandPayload, { type: "styles.set" }>["nodes"] | null {
    if (elements.length === 0 || elements.some((element) => !element.parentElement)) {
      return null;
    }
    // Group by parent so cross-container sets can be aligned in one pass
    const groups = new Map<HTMLElement, HTMLElement[]>();
    for (const element of elements) {
      const parent = element.parentElement!;
      const list = groups.get(parent) ?? [];
      list.push(element);
      groups.set(parent, list);
    }
    const changes: Extract<CommandPayload, { type: "styles.set" }>["nodes"] = [];
    for (const [parent, group] of groups) {
      const groupChanges = this.convertGroupToAbsolute(group, parent);
      if (!groupChanges) continue;
      changes.push(...groupChanges);
    }
    return changes.length > 0 ? changes : null;
  }

  private convertGroupToAbsolute(
    elements: HTMLElement[],
    parent: HTMLElement
  ): Extract<CommandPayload, { type: "styles.set" }>["nodes"] | null {
    const rects = elements.map((element) => element.getBoundingClientRect());
    const parentRect = parent.getBoundingClientRect();
    const changes: Extract<CommandPayload, { type: "styles.set" }>["nodes"] = [];
    const parentStyle = getComputedStyle(parent);
    elements.forEach((element, index) => {
      const rect = rects[index]!;
      const computed = getComputedStyle(element);
      const outOfFlow = ["absolute", "fixed"].includes(computed.position);
      const geometryBefore = GEOMETRY_PROPERTIES.map((property) =>
        inlineDeclaration(element, property)
      );
      const markerBefore = inlineDeclaration(element, FREE_ORIGIN_PROPERTY);
      const existingOrigin = element.style.getPropertyValue(
        FREE_ORIGIN_PROPERTY
      );
      const decodedOrigin = existingOrigin
        ? decodeFreeOrigin(existingOrigin)
        : null;
      const completeOrigin = decodedOrigin
        ? [
          ...decodedOrigin,
          ...geometryBefore.filter((declaration) =>
            !decodedOrigin.some((entry) =>
              entry.property === declaration.property
            )
          )
        ]
        : geometryBefore;
      const origin = encodeFreeOrigin(completeOrigin);
      const left = outOfFlow
        ? computed.left !== "auto"
          ? computed.left
          : `${rect.left - parentRect.left
            - (parseFloat(parentStyle.borderLeftWidth) || 0)
            + parent.scrollLeft}px`
        : computed.position === "relative" && computed.left !== "auto"
          ? computed.left
          : "0px";
      const top = outOfFlow
        ? computed.top !== "auto"
          ? computed.top
          : `${rect.top - parentRect.top
            - (parseFloat(parentStyle.borderTopWidth) || 0)
            + parent.scrollTop}px`
        : computed.position === "relative" && computed.top !== "auto"
          ? computed.top
          : "0px";
      const declarations = [
        explicitDeclaration("position", outOfFlow ? computed.position : "relative"),
        explicitDeclaration("left", left),
        explicitDeclaration("right", "auto"),
        explicitDeclaration("top", top),
        explicitDeclaration("bottom", "auto"),
        explicitDeclaration(FREE_ORIGIN_PROPERTY, origin)
      ];
      for (const declaration of declarations) {
        element.style.setProperty(declaration.property, declaration.value);
      }
      changes.push({
        nodeId: idOf(element),
        before: [...geometryBefore, markerBefore],
        after: declarations
      });
    });
    return changes;
  }

  private convertToLocalFree(): void {
    const elements = this.selectionElements().filter((element) =>
      element !== document.body
    );
    const changes = this.freeGeometryChanges(elements);
    if (!changes) return;
    this.commit({ type: "styles.set", nodes: changes });
    this.emitSelection();
    postToHost({
      type: "notice",
      message: `${elements.length} 个对象已转为自由定位，可直接拖动`
    });
  }

  private toggleFreeMovement(): void {
    const elements = this.selectionElements().filter(
      (element) => element !== document.body
    );
    if (elements.length === 0) return;
    const enabled = elements.every(
      (element) =>
        element.style.getPropertyValue(FREE_ORIGIN_PROPERTY) !== ""
    );
    if (!enabled) {
      const pending = elements.filter(
        (element) =>
          element.style.getPropertyValue(FREE_ORIGIN_PROPERTY) === ""
      );
      const changes = this.freeGeometryChanges(pending);
      if (!changes) return;
      this.commit({ type: "styles.set", nodes: changes });
      this.emitSelection();
      postToHost({
        type: "notice",
        message: `${pending.length} 个对象已开启自由移动`
      });
      return;
    }

    const changes: Extract<
      CommandPayload,
      { type: "styles.set" }
    >["nodes"] = [];
    const parents = new Set<HTMLElement>();
    for (const element of elements) {
      const origin = decodeFreeOrigin(
        element.style.getPropertyValue(FREE_ORIGIN_PROPERTY)
      );
      if (!origin) continue;
      const before = [
        ...GEOMETRY_PROPERTIES.map((property) =>
          inlineDeclaration(element, property)
        ),
        inlineDeclaration(element, FREE_ORIGIN_PROPERTY)
      ];
      const after = [
        ...origin,
        {
          property: FREE_ORIGIN_PROPERTY,
          value: "",
          priority: "" as const,
          existed: false
        }
      ];
      applyStyleDeclarations(element, after);
      changes.push({ nodeId: idOf(element), before, after });
      if (element.parentElement) parents.add(element.parentElement);
    }
    for (const parent of parents) {
      const hasFreeChild = [...parent.children].some(
        (child) =>
          child instanceof HTMLElement
          && child.style.getPropertyValue(FREE_ORIGIN_PROPERTY) !== ""
      );
      if (hasFreeChild) continue;
      const marker = parent.style.getPropertyValue(
        FREE_CONTAINER_ORIGIN_PROPERTY
      );
      const origin = decodeFreeOrigin(marker);
      if (!origin) continue;
      const before = [
        ...origin.map((declaration) =>
          inlineDeclaration(parent, declaration.property)
        ),
        inlineDeclaration(parent, FREE_CONTAINER_ORIGIN_PROPERTY)
      ];
      const after = [
        ...origin,
        {
          property: FREE_CONTAINER_ORIGIN_PROPERTY,
          value: "",
          priority: "" as const,
          existed: false
        }
      ];
      applyStyleDeclarations(parent, after);
      changes.push({
        nodeId: persistedIdOf(parent),
        before,
        after
      });
    }
    if (changes.length === 0) return;
    this.commit({ type: "styles.set", nodes: changes });
    this.emitSelection();
    postToHost({
      type: "notice",
      message: `${elements.length} 个对象已恢复原文档布局`
    });
  }

  private alignSelection(alignment: Alignment): void {
    const normalized = this.normalizeObjectSelection(
      this.selectionElements()
    );
    this.replaceSelection(normalized);
    const elements = normalized.filter(
      (element) => element !== document.body
    );
    if (elements.length < 2) {
      postToHost({ type: "notice", message: "请用 Shift 或 Ctrl 选择至少两个对象" });
      return;
    }
    const parent = elements[0]?.parentElement ?? null;
    if (
      !parent
      || elements.some((element) => element.parentElement !== parent)
    ) {
      postToHost({
        type: "notice",
        message: "只能对齐同一容器中的同级对象；请改选卡片外框或同一组元素"
      });
      return;
    }
    if (elements.some((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width <= 0 || rect.height <= 0;
    })) {
      postToHost({
        type: "notice",
        message: "选区中包含不可见对象，无法安全对齐"
      });
      return;
    }
    if (elements.length > 100) {
      postToHost({
        type: "notice",
        message: "一次最多对齐 100 个对象，请缩小选区"
      });
      return;
    }
    // Capture viewport-space boxes BEFORE freeGeometryChanges modifies styles,
    // so cross-container alignment can use a consistent coordinate system.
    const boxesBefore = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
    });
    const changes = this.freeGeometryChanges(elements);
    if (!changes) {
      postToHost({
        type: "notice",
        message: "无法转换为自由定位，对齐失败"
      });
      return;
    }
    // In viewport-space, the alignment target is calculated from the
    // initial positions. Each element's local `style.left/top` gets shifted
    // by the same delta (viewport deltas match parent-local deltas).
    const minLeft = Math.min(...boxesBefore.map((b) => b.x));
    const maxRight = Math.max(...boxesBefore.map((b) => b.x + b.w));
    const minTop = Math.min(...boxesBefore.map((b) => b.y));
    const maxBottom = Math.max(...boxesBefore.map((b) => b.y + b.h));
    const selectedIds = new Set(elements.map(idOf));
    for (const change of changes) {
      if (!selectedIds.has(change.nodeId)) continue;
      const element = elements.find((candidate) => idOf(candidate) === change.nodeId)!;
      const idx = elements.indexOf(element);
      const before = boxesBefore[idx]!;
      const elementComputed = getComputedStyle(element);
      const styleWidth = parseFloat(elementComputed.width) || before.w;
      const styleHeight = parseFloat(elementComputed.height) || before.h;
      const viewportW = element.getBoundingClientRect().width || styleWidth;
      const viewportH = element.getBoundingClientRect().height || styleHeight;
      let targetX = before.x;
      let targetY = before.y;
      if (alignment === "left") targetX = minLeft;
      if (alignment === "center") targetX = (minLeft + maxRight) / 2 - viewportW / 2;
      if (alignment === "right") targetX = maxRight - viewportW;
      if (alignment === "top") targetY = minTop;
      if (alignment === "middle") targetY = (minTop + maxBottom) / 2 - viewportH / 2;
      if (alignment === "bottom") targetY = maxBottom - viewportH;
      const dx = targetX - before.x;
      const dy = targetY - before.y;
      if (dx !== 0) {
        const currentLeft = parseFloat(element.style.left) || 0;
        element.style.left = `${currentLeft + dx}px`;
      }
      if (dy !== 0) {
        const currentTop = parseFloat(element.style.top) || 0;
        element.style.top = `${currentTop + dy}px`;
      }
      const newAfter: StyleDeclaration[] = change.after.map((decl) =>
        decl.property === "left"
          ? explicitDeclaration("left", element.style.left)
          : decl.property === "top"
            ? explicitDeclaration("top", element.style.top)
            : decl
      );
      change.after = newAfter;
    }
    this.commit({ type: "styles.set", nodes: changes });
    this.emitSelection();
    postToHost({ type: "notice", message: `${elements.length} 个对象已对齐` });
  }

  private acceptImage(path: string): void {
    if (!this.primary) {
      postToHost({ type: "notice", message: "请先选中一个元素" });
      return;
    }
    // Strategy 1: primary itself is an <img> → replace directly
    let target: HTMLImageElement | null = null;
    if (this.primary.tagName === "IMG") {
      target = this.primary as HTMLImageElement;
    } else {
      // Strategy 2: look for first <img> inside the selected element (e.g. inside a card)
      target = this.primary.querySelector<HTMLImageElement>("img");
    }
    if (target) {
      const before = target.getAttribute("src");
      target.setAttribute("src", path);
      this.commit({
        type: "attribute.set",
        nodeId: idOf(target),
        name: "src",
        before,
        after: path
      });
      this.setSelection(target);
      postToHost({ type: "notice", message: "图片已替换" });
      return;
    }
    // Strategy 3: no <img> found — offer to insert a new image at the end of the selection
    this.insertImageIntoElement(this.primary, path);
    postToHost({ type: "notice", message: "已在选中元素内插入图片" });
  }

  private acceptImages(
    images: Array<{ path: string; title: string }>
  ): void {
    const slots = this.selectedImageSlots.filter(
      (candidate) => candidate.container.isConnected
    );
    if (slots.length === 0) {
      postToHost({
        type: "notice",
        message: "请先点击“选择图片槽”，再在画布中点选需要填充的位置"
      });
      return;
    }

    const count = Math.min(images.length, slots.length);
    const htmlChanges: Array<{
      nodeId: string;
      before: string;
      after: string;
    }> = [];
    const attributeChanges: Array<{
      nodeId: string;
      name: string;
      before: string | null;
      after: string | null;
    }> = [];
    const styleChanges: Array<{
      nodeId: string;
      before: StyleDeclaration[];
      after: StyleDeclaration[];
    }> = [];
    for (let index = 0; index < count; index++) {
      const slot = slots[index]!;
      const image = images[index]!;
      if (slot.kind === "image" && slot.image) {
        const target = slot.image;
        const before = target.getAttribute("src");
        target.setAttribute("src", image.path);
        attributeChanges.push({
          nodeId: idOf(target),
          name: "src",
          before,
          after: image.path
        });
        if (target.hasAttribute("srcset")) {
          const srcset = target.getAttribute("srcset");
          target.removeAttribute("srcset");
          attributeChanges.push({
            nodeId: idOf(target),
            name: "srcset",
            before: srcset,
            after: null
          });
        }
        const picture = target.parentElement?.matches("picture")
          ? target.parentElement
          : null;
        for (const source of picture?.querySelectorAll<HTMLSourceElement>(
          "source"
        ) ?? []) {
          const srcset = source.getAttribute("srcset");
          if (srcset === null) continue;
          source.removeAttribute("srcset");
          attributeChanges.push({
            nodeId: idOf(source),
            name: "srcset",
            before: srcset,
            after: null
          });
        }
        continue;
      }
      if (slot.kind === "background") {
        const before = inlineDeclaration(slot.container, "background-image");
        const current = getComputedStyle(slot.container).backgroundImage;
        const replacement = `url("${image.path}")`;
        const next = current.includes("url(")
          ? current.replace(
            /url\((?:"[^"]*"|'[^']*'|[^)]*)\)/,
            replacement
          )
          : replacement;
        const after = explicitDeclaration(
          "background-image",
          next
        );
        slot.container.style.setProperty(after.property, after.value);
        styleChanges.push({
          nodeId: idOf(slot.container),
          before: [before],
          after: [after]
        });
        continue;
      }
      const before = slot.container.innerHTML;
      const element = document.createElement("img");
      element.src = image.path;
      element.alt = image.title || `批量导入图片 ${index + 1}`;
      element.draggable = false;
      element.loading = "lazy";
      Object.assign(element.style, {
        display: "block",
        width: "100%",
        height: "100%",
        objectFit: "contain"
      });
      slot.container.replaceChildren(element);
      htmlChanges.push({
        nodeId: idOf(slot.container),
        before,
        after: slot.container.innerHTML
      });
    }
    if (
      htmlChanges.length === 0
      && attributeChanges.length === 0
      && styleChanges.length === 0
    ) return;
    this.commit({
      type: "component.update",
      texts: [],
      html: htmlChanges,
      styles: styleChanges,
      attributes: attributeChanges
    });
    this.setSelection(slots[count - 1]!.container);
    const extraImages = images.length - count;
    const remainingSlots = slots.length - count;
    this.clearImageSlotSelection();
    postToHost({
      type: "notice",
      message: `已按点选顺序嵌入 ${count} 张图片`
        + (extraImages > 0 ? `，${extraImages} 张因没有对应已选槽位而跳过` : "")
        + (remainingSlots > 0 ? `，还有 ${remainingSlots} 个已选槽位未填充` : "")
    });
  }

  private selectImageSlots(mode: "toggle" | "all" | "clear"): void {
    if (mode === "clear") {
      this.clearImageSlotSelection();
      return;
    }
    if (mode === "toggle" && this.imageSlotSelectionMode) {
      this.imageSlotSelectionMode = false;
      this.renderImageSlotOverlays();
      this.emitImageSlotSelection();
      return;
    }
    this.imageSlotCandidates = this.detectImageSlots();
    this.imageSlotSelectionMode = true;
    if (mode === "all") {
      this.selectedImageSlots = [...this.imageSlotCandidates];
    } else {
      this.selectedImageSlots = this.selectedImageSlots.filter((selected) =>
        this.imageSlotCandidates.some(
          (candidate) => candidate.container === selected.container
        )
      );
    }
    this.renderImageSlotOverlays();
    this.emitImageSlotSelection();
    postToHost({
      type: "notice",
      message: this.imageSlotCandidates.length > 0
        ? `识别到 ${this.imageSlotCandidates.length} 个候选图片槽；请按希望的填充顺序点击`
        : "当前页面未识别到可替换的图片槽"
    });
  }

  private clearImageSlotSelection(): void {
    this.imageSlotSelectionMode = false;
    this.imageSlotCandidates = [];
    this.selectedImageSlots = [];
    this.imageSlotOverlay?.remove();
    this.imageSlotOverlay = null;
    this.emitImageSlotSelection();
  }

  private detectImageSlots(): ImageSlotCandidate[] {
    const candidates = new Map<HTMLElement, ImageSlotCandidate>();
    const semanticPattern =
      /(?:image|img|photo|picture|media|visual|thumbnail|thumb|screenshot|upload)[-_ ]*(?:slot|placeholder|frame|box|wrap|wrapper|container|card)\b|(?:图片|截图|封面)(?:槽|框|占位|容器)/i;
    const backgroundSemanticPattern =
      /(?:cover|hero|banner|visual|background|bg|封面|头图|背景)/i;
    const decorativePattern =
      /(?:logo|watermark|icon|avatar|badge|emoji|decoration|ornament|qr|二维码|水印|头像|图标)/i;
    const visibleBox = (element: HTMLElement): boolean => {
      const style = getComputedStyle(element);
      if (
        style.display === "none"
        || style.visibility === "hidden"
        || Number(style.opacity) === 0
      ) return false;
      const rect = element.getBoundingClientRect();
      return rect.width >= 48
        && rect.height >= 48
        && rect.width * rect.height >= 4_096;
    };
    const descriptorOf = (element: HTMLElement): string => [
      element.id,
      element.className,
      element.getAttribute("role") ?? "",
      element.getAttribute("aria-label") ?? "",
      element.getAttribute("alt") ?? "",
      ...element.getAttributeNames().filter((name) =>
        name.startsWith("data-")
      )
    ].join(" ");
    const isDecorative = (element: HTMLElement): boolean =>
      decorativePattern.test(descriptorOf(element));
    const add = (
      container: HTMLElement,
      kind: ImageSlotCandidate["kind"],
      image?: HTMLImageElement
    ): void => {
      if (
        container.closest("[data-hs-overlay]")
        || !visibleBox(container)
        || isDecorative(container)
        || (image && isDecorative(image))
      ) return;
      candidates.set(container, {
        container,
        kind,
        ...(image ? { image } : {})
      });
    };

    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      if (element.matches("script, style, canvas, svg, video, iframe")) continue;
      const descriptor = descriptorOf(element);
      const image = element instanceof HTMLImageElement
        ? element
        : element.querySelector<HTMLImageElement>(
          ":scope > img, :scope > picture img"
        );
      const hasGenericDataSlot = element.hasAttribute("data-slot")
        && Boolean(
          image
          || semanticPattern.test(descriptor)
          || /上传|替换|图片|截图|封面/.test(element.textContent ?? "")
        );
      const hasImageBackground =
        getComputedStyle(element).backgroundImage.includes("url(");
      if (
        semanticPattern.test(descriptor)
        || hasGenericDataSlot
        || (
          hasImageBackground
          && backgroundSemanticPattern.test(descriptor)
        )
      ) {
        if (image) {
          add(element, "image", image);
        } else if (hasImageBackground) {
          add(element, "background");
        } else {
          add(element, "container");
        }
      }
    }

    for (const image of document.querySelectorAll<HTMLImageElement>("img")) {
      if (
        [...candidates.values()].some(
          (candidate) =>
            candidate.image === image || candidate.container.contains(image)
        )
      ) continue;
      add(image, "image", image);
    }

    return [...candidates.values()].sort((left, right) => {
      if (left.container === right.container) return 0;
      return left.container.compareDocumentPosition(right.container)
        & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  private findImageSlotCandidate(
    target: Element
  ): ImageSlotCandidate | undefined {
    return this.imageSlotCandidates
      .filter((candidate) =>
        candidate.container === target || candidate.container.contains(target)
      )
      .sort((left, right) =>
        left.container.contains(right.container) ? 1 : -1
      )[0];
  }

  private refreshImageSlotCandidates(): void {
    const selectedContainers = new Set(
      this.selectedImageSlots
        .filter((candidate) => candidate.container.isConnected)
        .map((candidate) => candidate.container)
    );
    this.imageSlotCandidates = this.detectImageSlots();
    this.selectedImageSlots = this.imageSlotCandidates.filter((candidate) =>
      selectedContainers.has(candidate.container)
    );
  }

  private toggleImageSlotCandidate(candidate: ImageSlotCandidate): void {
    const selectedIndex = this.selectedImageSlots.findIndex(
      (selected) => selected.container === candidate.container
    );
    if (selectedIndex >= 0) {
      this.selectedImageSlots.splice(selectedIndex, 1);
    } else {
      this.selectedImageSlots.push(candidate);
    }
  }

  private renderImageSlotOverlays(): void {
    this.imageSlotOverlay?.remove();
    this.imageSlotOverlay = null;
    const shown = this.imageSlotSelectionMode
      ? this.imageSlotCandidates
      : this.selectedImageSlots;
    if (shown.length === 0) return;
    const root = document.createElement("div");
    root.dataset.hsOverlay = "image-slots";
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "2147483646"
    });
    for (const candidate of shown) {
      if (!candidate.container.isConnected) continue;
      const rect = candidate.container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const selectedIndex = this.selectedImageSlots.indexOf(candidate);
      const marker = document.createElement("div");
      Object.assign(marker.style, {
        position: "fixed",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        boxSizing: "border-box",
        border: selectedIndex >= 0
          ? "4px solid #16a34a"
          : "3px dashed #2563eb",
        background: selectedIndex >= 0
          ? "rgba(22,163,74,.12)"
          : "rgba(37,99,235,.06)",
        borderRadius: "6px"
      });
      if (selectedIndex >= 0) {
        const badge = document.createElement("span");
        badge.textContent = String(selectedIndex + 1);
        Object.assign(badge.style, {
          position: "absolute",
          left: "-4px",
          top: "-28px",
          minWidth: "28px",
          height: "28px",
          padding: "0 7px",
          borderRadius: "14px",
          background: "#16a34a",
          color: "#fff",
          font: "700 14px/28px sans-serif",
          textAlign: "center",
          boxShadow: "0 2px 8px rgba(0,0,0,.2)"
        });
        marker.appendChild(badge);
      }
      root.appendChild(marker);
    }
    document.body.appendChild(root);
    this.imageSlotOverlay = root;
  }

  private emitImageSlotSelection(): void {
    postToHost({
      type: "image-slot-selection",
      active: this.imageSlotSelectionMode,
      candidates: this.imageSlotCandidates.length,
      selected: this.selectedImageSlots.length
    });
  }

  /** Insert a new <img> element as a child of the given parent. */
  private insertImageIntoElement(parent: HTMLElement, path: string): void {
    const img = document.createElement("img");
    img.src = path;
    img.alt = "插入的图片";
    img.draggable = false;
    img.loading = "lazy";
    Object.assign(img.style, {
      display: "block",
      width: "200px",
      minWidth: "80px",
      minHeight: "40px",
      height: "auto",
      maxWidth: "100%",
      margin: "12px 0",
      border: "1px dashed #4f7cff",
      background: "#f0f4ff",
      objectFit: "contain"
    });
    img.dataset.hsId = `node_${crypto.randomUUID()}`;
    parent.appendChild(img);
    img.addEventListener("load", () => {
      img.style.width = "";
      img.style.minWidth = "";
      img.style.minHeight = "";
      img.style.border = "";
      img.style.background = "";
      img.style.objectFit = "";
    }, { once: true });
    const nodeId = idOf(img);
    const parentId = idOf(parent);
    this.commit({
      type: "node.insert",
      parentId,
      index: [...parent.children].indexOf(img),
      node: { id: nodeId, tagName: "img", attributes: { src: path, alt: "插入的图片" }, text: "" }
    });
    this.setSelection(img);
  }

  private reportState(): void {
    const state: EditorState = {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      selectedNodeIds: [...this.selected].map(idOf)
    };
    postToHost({ type: "editor-state", state });
  }

  private restoreState(saved: EditorState): void {
    window.scrollTo(saved.scrollX, saved.scrollY);
    if (saved.selectedNodeIds.length === 0) return;
    requestAnimationFrame(() => {
      const elements: HTMLElement[] = [];
      for (const nodeId of saved.selectedNodeIds) {
        const element = document.querySelector<HTMLElement>(
          `[data-hs-id="${CSS.escape(nodeId)}"]`
        );
        if (element?.isConnected) elements.push(element);
      }
      if (elements.length === 0) return;
      this.selected.clear();
      for (const element of elements) {
        this.selected.add(element);
      }
      this.emitSelection();
      postToHost({
        type: "notice",
        message: `已恢复 ${elements.length} 个选中对象`
      });
    });
  }

  private deleteSelected(): void {
    const elements = this.selectionElements();
    if (elements.length === 0) return;
    const protectedIds = new Set(
      elements.flatMap((element) => this.scriptMountIdsWithin(element))
    );
    if (protectedIds.size > 0) {
      postToHost({
        type: "notice",
        message:
          `无法删除：页面脚本仍依赖 ${[...protectedIds].slice(0, 3).map(
            (id) => `#${id}`
          ).join("、")}${protectedIds.size > 3 ? " 等节点" : ""}`
      });
      return;
    }
    for (const element of elements) {
      const parent = element.parentElement;
      if (!parent?.isConnected) continue;
      const index = [...parent.children].indexOf(element);
      const tagName = element.tagName.toLowerCase();
      const attributes: Record<string, string> = {};
      for (const attribute of [...element.attributes]) {
        if (attribute.name !== "data-hs-id") {
          attributes[attribute.name] = attribute.value;
        }
      }
      element.remove();
      this.commit({
        type: "node.delete",
        nodeId: idOf(element),
        parentId: persistedIdOf(parent),
        index,
        node: {
          id: idOf(element),
          tagName,
          attributes,
          text: element.innerHTML
        }
      });
    }
    this.selected.clear();
    this.emitSelection();
    postToHost({ type: "notice", message: `已删除 ${elements.length} 个对象` });
  }

  private scriptMountIdsWithin(element: HTMLElement): string[] {
    const referenced = new Set<string>();
    for (const script of [...document.scripts]) {
      const source = script.textContent ?? "";
      for (const match of source.matchAll(
        /getElementById\s*\(\s*(['"])([^'"]+)\1\s*\)/g
      )) {
        if (match[2]) referenced.add(match[2]);
      }
      for (const match of source.matchAll(
        /querySelector(?:All)?\s*\(\s*(['"])\s*#([A-Za-z][\w:.-]*)\1\s*\)/g
      )) {
        if (match[2]) referenced.add(match[2]);
      }
    }
    const containedIds = [
      ...(element.id ? [element.id] : []),
      ...[...element.querySelectorAll<HTMLElement>("[id]")]
        .map((candidate) => candidate.id)
        .filter(Boolean)
    ];
    return containedIds.filter((id) => referenced.has(id));
  }

  private copySelected(): void {
    const elements = this.selectionElements();
    if (elements.length === 0) return;
    try {
      const snapshots = elements.map((element) => {
        const tag = element.tagName.toLowerCase();
        const attrs: Record<string, string> = {};
        for (const attribute of [...element.attributes]) {
          if (attribute.name !== "data-hs-id") {
            attrs[attribute.name] = attribute.value;
          }
        }
        // Don't carry dyn_ ids to the paste — they'll get new ids
        const nodeId = idOf(element);
        const persistentId = isDynamicId(nodeId) ? null : nodeId;
        return {
          tagName: tag,
          attributes: attrs,
          text: element.innerHTML,
          hsId: persistentId
        };
      });
      postToHost({
        type: "clipboard-data",
        data: JSON.stringify(snapshots)
      });
      postToHost({ type: "notice", message: `已复制 ${elements.length} 个对象` });
    } catch (error) {
      postToHost({
        type: "notice",
        message: `复制失败：${error instanceof Error ? error.message : "未知错误"}`
      });
    }
  }

  private pasteClipboard(data: string): void {
    try {
      const snapshots = JSON.parse(data) as Array<{
        tagName: string;
        attributes: Record<string, string>;
        text: string;
        hsId: string | null;
      }>;
      if (!Array.isArray(snapshots) || snapshots.length === 0) return;
      const parent = this.findPasteParent();
      if (!parent) {
        postToHost({ type: "notice", message: "未找到可粘贴的父容器" });
        return;
      }
      for (const snapshot of snapshots) {
        const id = `node_${crypto.randomUUID()}`;
        const element = document.createElement(snapshot.tagName);
        element.setAttribute("data-hs-id", id);
        for (const [name, value] of Object.entries(snapshot.attributes)) {
          element.setAttribute(name, value);
        }
        element.innerHTML = snapshot.text;
        parent.appendChild(element);
        this.commit({
          type: "node.insert",
          parentId: persistedIdOf(parent),
          index: parent.children.length - 1,
          node: {
            id,
            tagName: snapshot.tagName,
            attributes: { ...snapshot.attributes, style: element.getAttribute("style") ?? "" },
            text: snapshot.text
          }
        });
      }
      postToHost({
        type: "notice",
        message: `已粘贴 ${snapshots.length} 个对象`
      });
    } catch (error) {
      postToHost({
        type: "notice",
        message: `粘贴失败：${error instanceof Error ? error.message : "未知错误"}`
      });
    }
  }

  private findPasteParent(): HTMLElement | null {
    if (this.primary?.isConnected) {
      return this.primary.parentElement ?? document.body;
    }
    // Fall back to the closest .page container, then body
    return document.querySelector(".page-inner")
      ?? document.querySelector(".page")
      ?? document.body;
  }

  private isTextSelected(): boolean {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
    return sel.toString().trim().length > 0;
  }

  /** GrapesJS core:component-clone */
  private cloneSelected(): void {
    if (!this.primary) return;
    const source = this.primary;
    const clone = source.cloneNode(true) as HTMLElement;
    for (const candidate of [
      clone,
      ...clone.querySelectorAll<HTMLElement>("[data-hs-id]")
    ]) {
      candidate.dataset.hsId = `node_${crypto.randomUUID()}`;
      candidate.removeAttribute("contenteditable");
      candidate.removeAttribute("data-hs-dyn-patches");
      candidate.removeAttribute("data-hs-chart-stable-id");
      candidate.classList.remove("hs-hover-outline");
    }
    const newId = clone.dataset.hsId!;
    source.parentElement?.insertBefore(clone, source.nextSibling);
      const parent = source.parentElement!;
      const index = [...parent.children].indexOf(clone);
      const attributes: Record<string, string> = {};
      for (const attribute of [...clone.attributes]) {
        if (attribute.name !== "data-hs-id") {
          attributes[attribute.name] = attribute.value;
        }
      }
      this.commit({
        type: "node.insert",
        parentId: persistedIdOf(parent),
        index: index >= 0 ? index : parent.children.length - 1,
        node: {
          id: newId,
          tagName: source.tagName.toLowerCase(),
          attributes,
          text: clone.innerHTML
        }
      });
    this.setSelection(clone);
    postToHost({ type: "notice", message: "已克隆" });
  }

  /** Arrow-key nudge: move selected elements by dx/dy px */
  private nudge(dx: number, dy: number): void {
    const elements = this.selectionElements();
    if (elements.length === 0) return;
    const nodes: Array<{
      nodeId: string;
      before: StyleDeclaration[];
      after: StyleDeclaration[];
    }> = [];
    for (const el of elements) {
      if (el.style.getPropertyValue(FREE_ORIGIN_PROPERTY) === "") continue;
      const beforeLeft = inlineDeclaration(el, "left");
      const beforeTop = inlineDeclaration(el, "top");
      const newLeft = (parseFloat(el.style.left) || 0) + dx;
      const newTop = (parseFloat(el.style.top) || 0) + dy;
      el.style.left = `${newLeft}px`;
      el.style.top = `${newTop}px`;
      nodes.push({
        nodeId: idOf(el),
        before: [beforeLeft, beforeTop],
        after: [
          explicitDeclaration("left", `${newLeft}px`),
          explicitDeclaration("top", `${newTop}px`)
        ]
      });
    }
    if (nodes.length > 0) {
      this.commit({ type: "styles.set", nodes });
      // Propagate to symbol instances
      this.propagateSymbolChanges(nodes);
      postToHost({
        type: "notice",
        message: `已移动 ${nodes.length} 个对象`
      });
    } else {
      postToHost({
        type: "notice",
        message: "请先开启自由移动"
      });
    }
    this.emitSelection();
  }

  /** Select all elements inside the same parent */
  private selectAllInContainer(): void {
    if (!this.primary) return;
    const parent = this.primary.parentElement;
    if (!parent) return;
    const siblings = parent.querySelectorAll<HTMLElement>("[data-hs-id]");
    this.selected.clear();
    for (const el of siblings) {
      if (el !== parent) this.selected.add(el);
    }
    this.emitSelection();
    postToHost({ type: "notice", message: `已选中 ${this.selected.size} 个对象` });
  }

  /** GrapesJS Symbols: toggle symbol marking on the selected element */
  private toggleSymbol(): void {
    if (!this.primary) return;
    const existing = this.primary.getAttribute("data-hs-symbol");
    if (existing) {
      this.primary.removeAttribute("data-hs-symbol");
      postToHost({ type: "notice", message: "已取消符号" });
    } else {
      const symbolId = `sym_${crypto.randomUUID()}`;
      this.primary.setAttribute("data-hs-symbol", symbolId);
      postToHost({ type: "notice", message: "已标记为符号" });
    }
    this.emitSelection();
  }

  /**
   * When a symbol element is edited, apply the same changes to all other
   * instances with the same symbol ID. Called automatically from commit().
   */
  private propagateSymbolChanges(nodes: Array<{ nodeId: string; before: StyleDeclaration[]; after: StyleDeclaration[] }>): void {
    for (const change of nodes) {
      const source = document.querySelector<HTMLElement>(`[data-hs-id="${CSS.escape(change.nodeId)}"]`);
      const symbolId = source?.getAttribute("data-hs-symbol");
      if (!symbolId) continue;
      const instances = document.querySelectorAll<HTMLElement>(`[data-hs-symbol="${CSS.escape(symbolId)}"]`);
      for (const inst of instances) {
        if (idOf(inst) === change.nodeId) continue;
        for (const decl of change.after) {
          inst.style.setProperty(decl.property, decl.value, decl.priority);
        }
      }
    }
  }

  private propagateSymbolText(nodeId: string, newValue: string): void {
    const source = document.querySelector<HTMLElement>(`[data-hs-id="${CSS.escape(nodeId)}"]`);
    const symbolId = source?.getAttribute("data-hs-symbol");
    if (!symbolId) return;
    const instances = document.querySelectorAll<HTMLElement>(`[data-hs-symbol="${CSS.escape(symbolId)}"]`);
    for (const inst of instances) {
      if (idOf(inst) === nodeId) continue;
      // For patchStyle: replace innerHTML; for text.set: replace textContent
      if (source?.isContentEditable || inst.innerHTML !== source?.innerHTML) {
        inst.innerHTML = source?.innerHTML ?? "";
      } else {
        inst.textContent = source?.textContent ?? "";
      }
    }
  }

  /** Tab/Shift+Tab: select the next/previous sibling element */
  private selectNextSibling(forward: boolean): void {
    if (!this.primary) return;
    const parent = this.primary.parentElement;
    if (!parent) return;
    const siblings = [...parent.querySelectorAll<HTMLElement>("[data-hs-id]")].filter(el => el !== parent);
    const idx = siblings.indexOf(this.primary);
    if (idx < 0) return;
    const nextIdx = forward ? idx + 1 : idx - 1;
    if (nextIdx < 0 || nextIdx >= siblings.length) return;
    this.setSelection(siblings[nextIdx]!);
  }

  /** Insert a block either into document flow or as a free-positioned object. */
  private insertBlock(
    blockType: string,
    placement: "flow" | "free"
  ): void {
    try {
      const BLOCKS: Record<string, () => HTMLElement> = {
        h1: () => { const el = document.createElement("h1"); el.textContent = "标题一"; el.style.cssText = "min-height:24px;margin:8px 0;color:inherit"; return el; },
        h2: () => { const el = document.createElement("h2"); el.textContent = "标题二"; el.style.cssText = "min-height:20px;margin:8px 0;color:inherit"; return el; },
        h3: () => { const el = document.createElement("h3"); el.textContent = "标题三"; el.style.cssText = "min-height:18px;margin:8px 0;color:inherit"; return el; },
        p: () => { const el = document.createElement("p"); el.textContent = "正文段落，双击编辑文字内容。"; el.style.cssText = "min-height:18px;margin:8px 0;color:inherit"; return el; },
        card: () => {
          const el = document.createElement("div");
          el.innerHTML = "<h3>卡片标题</h3><p>卡片内容，可嵌套图片和文字。</p>";
          Object.assign(el.style, { padding: "16px", border: "1px solid #ddd", borderRadius: "6px", margin: "8px 0", background: "#fff" });
          return el;
        },
        img: () => {
          const el = document.createElement("img");
          el.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='120'><rect width='200' height='120' fill='%23e0e7ff'/><text x='100' y='55' text-anchor='middle' fill='%234f7cff' font-size='12'>图片占位</text><text x='100' y='75' text-anchor='middle' fill='%234f7cff' font-size='10'>点击后替换</text></svg>";
          Object.assign(el.style, { display: "block", maxWidth: "100%", height: "auto", border: "1px dashed #ccc" });
          el.alt = "图片占位";
          return el;
        },
        chart: () => {
          // Phase 6: real ECharts line chart, draggable points enabled
          const el = document.createElement("div");
          el.dataset.hsChart = "echarts-line";
          Object.assign(el.style, {
            minHeight: "280px",
            height: "280px",
            width: "100%",
            border: "1px solid #dde3ee",
            borderRadius: "6px",
            margin: "8px 0",
            background: "#fff"
          });
          // Initialize ECharts asynchronously (so the element is in DOM first)
          const initialData = {
            type: "line",
            xAxis: ["1月", "2月", "3月", "4月", "5月", "6月"],
            series: [{ name: "销量", data: [120, 200, 150, 80, 70, 110] }],
            color: "#4f7cff"
          };
          el.dataset.hsChartData = JSON.stringify(initialData);
          queueMicrotask(() => {
            try {
              const echarts = (window as unknown as { echarts?: { init: (el: HTMLElement) => { setOption: (o: unknown) => void; resize: () => void } } }).echarts;
              if (echarts) {
                const inst = echarts.init(el);
                inst.setOption({
                  tooltip: { trigger: "axis" },
                  grid: { left: 30, right: 20, top: 30, bottom: 30 },
                  xAxis: { type: "category", data: initialData.xAxis, boundaryGap: false },
                  yAxis: { type: "value" },
                  series: [{
                    type: "line",
                    name: initialData.series[0]?.name,
                    data: initialData.series[0]?.data,
                    smooth: true,
                    symbol: "circle",
                    symbolSize: 10,
                    itemStyle: { color: initialData.color },
                    lineStyle: { color: initialData.color, width: 2 }
                  }]
                });
                (el as HTMLElement & { _chartInstance?: unknown })._chartInstance = inst;
                setTimeout(() => inst.resize(), 100);
              }
            } catch (err) {
              console.error("[insertBlock chart] ECharts init failed:", err);
            }
          });
          return el;
        },
        separator: () => { const el = document.createElement("hr"); Object.assign(el.style, { margin: "20px 0" }); return el; },
        button: () => {
          const el = document.createElement("button");
          el.textContent = "按钮";
          Object.assign(el.style, { padding: "8px 20px", background: "#4f7cff", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "14px" });
          return el;
        },
        video: () => {
          const el = document.createElement("video");
          el.dataset.hsVideo = "placeholder";
          el.controls = true;
          el.preload = "metadata";
          el.setAttribute("aria-label", "视频占位，选择后从右侧导入视频");
          Object.assign(el.style, {
            display: "block",
            width: "100%",
            minHeight: "180px",
            margin: "8px 0",
            border: "1px dashed #4f7cff80",
            borderRadius: "6px",
            background: "#111827"
          });
          return el;
        }
      };

      const factory = BLOCKS[blockType];
      if (!factory) return;

      const el = factory();
      const nodeId = `node_${crypto.randomUUID()}`;
      el.dataset.hsId = nodeId;
      if (placement === "free" && !el.style.cssText.includes("position")) {
        const scrollY = window.scrollY;
        el.style.cssText += `;position:absolute;left:20px;top:${scrollY + 40}px;min-width:120px;min-height:28px;z-index:10;background:rgba(255,255,255,0.95);box-shadow:0 1px 4px rgba(0,0,0,0.08);border-radius:4px`;
      }

      let parent: HTMLElement;
      let ref: Node | null = null;
      const pageInner = document.querySelector<HTMLElement>(".page-inner");
      const page = document.querySelector<HTMLElement>(".page");
      if (placement === "free") {
        parent = pageInner ?? page ?? document.body;
      } else if (this.primary?.isConnected) {
        const containerTags = new Set([
          "DIV", "SECTION", "ARTICLE", "MAIN", "ASIDE", "HEADER",
          "FOOTER", "LI", "TD", "FIGURE"
        ]);
        if (
          containerTags.has(this.primary.tagName)
        ) {
          // Match component builders such as GrapesJS: a selected container
          // receives the new component as a child. Dynamic containers are
          // supported by DynamicNodeManager's local structural freeze.
          parent = this.primary;
        } else {
          parent = this.primary.parentElement ?? pageInner ?? page ?? document.body;
          ref = this.primary.nextSibling;
        }
      } else {
        parent = pageInner ?? page ?? document.body;
      }
      // Ensure parent has id (skip body/html)
      if (parent !== document.body && parent !== document.documentElement
          && !idOf(parent)) {
        parent.dataset.hsId = `node_${crypto.randomUUID()}`;
      }

      if (ref) parent.insertBefore(el, ref);
      else parent.appendChild(el);

      const index = [...parent.children].indexOf(el);
      const tag = el.tagName.toLowerCase();
      const attributes: Record<string, string> = {};
      for (const attribute of [...el.attributes]) {
        if (attribute.name !== "data-hs-id") {
          attributes[attribute.name] = attribute.value;
        }
      }
      this.commit({
        type: "node.insert",
        parentId: persistedIdOf(parent),
        index: index >= 0 ? index : parent.children.length - 1,
        node: {
          id: nodeId,
          tagName: tag,
          attributes,
          text: el.innerHTML
        }
      });
      this.setSelection(el);
      // Scroll the new block into view
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // If it's a chart, spark initialization
      if (blockType === "chart") {
        window.setTimeout(() => this.initChartElements(), 100);
      }
      postToHost({
        type: "notice",
        message: placement === "flow"
          ? `已嵌入 ${blockType}`
          : `已插入自由定位 ${blockType}`
      });
    } catch (err) {
      console.error("[insertBlock] failed:", err);
      postToHost({ type: "notice", message: "组件插入失败，请重试" });
    }
  }

  /** Phase 6/8: Scan [data-hs-chart] elements and render them as ECharts.
   *  Phase 8 adds real drag-to-edit on data points (line/area charts) and
   *  multi-type support (line / bar / area). */
  initChartElements(): void {
    const e = (window as unknown as {
      echarts?: {
        init: (el: HTMLElement) => EChartInstance;
        util?: { map: <T,R>(a: T[], f: (v: T, i: number) => R) => R[] };
      };
    }).echarts;
    if (!e) return;

    document.querySelectorAll<HTMLElement & { _hsChartReady?: boolean }>("[data-hs-chart]").forEach((el) => {
      if (el._hsChartReady) return;
      el._hsChartReady = true;

      try {
        const raw = el.dataset.hsChartData;
        const config: ChartBlockData = raw ? JSON.parse(raw) : getDefaultChartData();
        if (!config.style) {
          const sourceSvg = el.querySelector<SVGSVGElement>("svg");
          const recoveredStyle = sourceSvg
            ? styleProfileForSvg(sourceSvg)
            : undefined;
          if (recoveredStyle) {
            config.style = recoveredStyle;
            el.dataset.hsChartData = JSON.stringify(config);
          }
        }
        const inst = e.init(el);
        inst.setOption(buildEChartsOption(config));
        setTimeout(() => inst.resize(), 150);

        // Drag-to-edit for line/area charts only (not pie/bar)
        if ((config.type === "line" || config.type === "area") && e.util) {
          setTimeout(() => this.attachChartDrag(el, inst, config, e), 300);
        }
      } catch (err) {
        console.error("[initChartElements]", err);
      }
    });
  }

  /** Phase 8: attach invisible draggable circles to each data point.
   *  On drag, convert pixel→data, update array, re-render, persist. */
  private attachChartDrag(
    el: HTMLElement,
    inst: EChartInstance,
    config: ChartBlockData,
    e: {
      util?: { map: <T,R>(a: T[], f: (v: T, i: number) => R) => R[] };
    }
  ): void {
    if (!e.util) return;
    const xData = config.xAxis;
    const s = config.series[0];
    if (!s) return;
    const chartInstance = e; // capture for closure

    const circles = e.util.map(s.data, (_val: number, i: number) => {
      const val = s.data[i] ?? 0;
      const pos = inst.convertToPixel?.("grid", [xData[i] ?? "", val]) ?? [0, 0];
      // ECharts graphic callback: `this` = the graphic element.
      // Its `.position` is the current pixel position.
      // Capture runtime methods via closure (not via `this`, which is the graphic).
      const runtime = this;
      const element = el;
      const chartConfig = config;
      const series = s;
      return {
        type: "circle", position: pos, shape: { r: 8 },
        style: { fill: "rgba(79,124,255,0.25)", stroke: "#4f7cff", lineWidth: 1 },
        draggable: true, z: 100,
        ondrag: function () {
          if (!inst.convertFromPixel) return;
          const dataCoord = inst.convertFromPixel("grid", (this as { position: [number, number] }).position);
          if (Array.isArray(dataCoord) && typeof dataCoord[1] === "number") {
            const newVal = Math.max(0, Math.round(dataCoord[1] as number));
            series.data[i] = newVal;
            inst.setOption({ series: [{ data: series.data }] });
            element.dataset.hsChartData = JSON.stringify(chartConfig);
            // Persist via attribute.set
            runtime.commit({
              type: "attribute.set",
              nodeId: idOf(element),
              name: "data-hs-chart-data",
              before: null,
              after: JSON.stringify(chartConfig)
            });
            // Re-attach drag circles at new positions
            setTimeout(() => runtime.refreshChartDragPoints(element, inst, chartConfig, chartInstance), 0);
          }
        }
      } as Record<string, unknown>;
    });
    inst.setOption({ graphic: circles as unknown as Record<string, unknown>[] });
  }

  /** Re-position the drag circles after a data update */
  private refreshChartDragPoints(
    el: HTMLElement,
    inst: EChartInstance,
    config: ChartBlockData,
    e: { util?: { map: <T,R>(a: T[], f: (v: T, i: number) => R) => R[] } }
  ): void {
    if (!e.util) return;
    const xData = config.xAxis;
    const s = config.series[0];
    if (!s) return;
    const circles = e.util.map(s.data, (val: number, i: number) => {
      const pos = inst.convertToPixel?.("grid", [xData[i] ?? "", val]) ?? [0, 0];
      return {
        type: "circle", position: pos, shape: { r: 8 },
        style: { fill: "rgba(79,124,255,0.25)", stroke: "#4f7cff", lineWidth: 1 },
        draggable: true, z: 100
      } as Record<string, unknown>;
    });
    inst.setOption({ graphic: circles as unknown as Record<string, unknown>[] });
  }

  /** GrapesJS z-index: delta > 0 = bring forward, delta < 0 = send back */
  private adjustZIndex(delta: number): void {
    const elements = this.selectionElements().filter(
      (element) =>
        element.style.getPropertyValue(FREE_ORIGIN_PROPERTY) !== ""
    );
    if (elements.length === 0) {
      postToHost({
        type: "notice",
        message: "叠放层级只对自由移动对象生效"
      });
      return;
    }
    const nodes = elements.map((element) => {
      const current = Number.parseInt(
        getComputedStyle(element).zIndex,
        10
      ) || 0;
      const before = inlineDeclaration(element, "z-index");
      const newZ = Math.max(0, current + delta);
      element.style.zIndex = String(newZ);
      return {
        nodeId: idOf(element),
        before: [before],
        after: [explicitDeclaration("z-index", String(newZ))]
      };
    });
    this.commit({ type: "styles.set", nodes });
    this.emitSelection();
    postToHost({
      type: "notice",
      message: `${elements.length} 个对象层级已调整`
    });
  }

  /** GrapesJS LayerManager: tree of all [data-hs-id] elements */
  private reportLayers(): void {
    const seen = new Set<string>();
    let emitted = 0;
    const maximum = 1_000;
    function walk(el: Element): LayerNode[] {
      const nodes: LayerNode[] = [];
      for (const child of el.children) {
        if (emitted >= maximum) break;
        if (child instanceof HTMLElement && child.dataset.hsOverlay) continue;
        const id = child instanceof HTMLElement ? child.getAttribute("data-hs-id") : null;
        if (!id) { nodes.push(...walk(child)); continue; }
        if (seen.has(id)) continue;
        seen.add(id);
        emitted += 1;
        nodes.push({
          id, tag: child.tagName.toLowerCase(),
          text: child.textContent?.trim().slice(0, 40) ?? child.tagName.toLowerCase(),
          children: walk(child)
        });
      }
      return nodes;
    }
    (postToHost as unknown as (m: Record<string, unknown>) => void)({
      type: "layers", layers: walk(document.body)
    });
  }

  /** Phase 7: return the full document source HTML for the code viewer. */
  private reportSource(): void {
    const html = "<!doctype html>\n" + document.documentElement.outerHTML;
    (postToHost as unknown as (m: Record<string, unknown>) => void)({
      type: "source-code", html
    });
  }

  private async waitForDomStability(
    quietMilliseconds = 400,
    maximumMilliseconds = 4_000
  ): Promise<void> {
    await new Promise<void>((resolve) => {
      let quietTimer = window.setTimeout(finish, quietMilliseconds);
      const maximumTimer = window.setTimeout(finish, maximumMilliseconds);
      const observer = new MutationObserver(() => {
        window.clearTimeout(quietTimer);
        quietTimer = window.setTimeout(finish, quietMilliseconds);
      });
      function finish(): void {
        observer.disconnect();
        window.clearTimeout(quietTimer);
        window.clearTimeout(maximumTimer);
        resolve();
      }
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
    });
  }

  /**
   * Freeze the live, script-rendered page into a new static project. The
   * original project remains untouched, which makes this safer than trying
   * to express a whole-document replacement as thousands of node commands.
   */
  private async materializeDocument(): Promise<void> {
    if (this.contentEditable) this.commitContentEditable();
    postToHost({
      type: "notice",
      message: "正在等待动态页面稳定并生成静态副本…"
    });
    await this.waitForDomStability();

    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    const liveElements = [...document.documentElement.querySelectorAll("*")];
    const cloneElements = [...clone.querySelectorAll("*")];
    let canvasSnapshots = 0;
    for (let index = 0; index < liveElements.length; index += 1) {
      const live = liveElements[index];
      const copied = cloneElements[index];
      if (!live || !copied) continue;
      if (live instanceof HTMLCanvasElement) {
        try {
          const image = document.createElement("img");
          image.src = live.toDataURL("image/png");
          image.width = live.width;
          image.height = live.height;
          image.alt = live.getAttribute("aria-label") ?? "Canvas snapshot";
          image.setAttribute(
            "style",
            copied.getAttribute("style") ?? live.getAttribute("style") ?? ""
          );
          copied.replaceWith(image);
          canvasSnapshots += 1;
        } catch {
          copied.setAttribute("data-hs-materialize-warning", "canvas-unavailable");
        }
      }
      if (live instanceof HTMLElement && live.shadowRoot) {
        copied.innerHTML = live.shadowRoot.innerHTML;
        copied.setAttribute("data-hs-materialized-shadow-root", "");
      }
    }

    clone.querySelectorAll("[data-hs-overlay]").forEach((element) => {
      element.remove();
    });
    clone.querySelectorAll("[data-hs-runtime-style]").forEach((element) => {
      element.remove();
    });
    clone.querySelectorAll("meta[http-equiv]").forEach((element) => {
      if (
        element.getAttribute("http-equiv")?.toLowerCase()
          === "content-security-policy"
      ) {
        element.remove();
      }
    });
    clone.querySelectorAll("script").forEach((script) => {
      const type = script.getAttribute("type")?.toLowerCase() ?? "";
      if (type !== "application/json" && type !== "application/ld+json") {
        script.remove();
      }
    });

    let convertedDynamicIds = 0;
    for (const element of clone.querySelectorAll<HTMLElement>("*")) {
      element.classList.remove("hs-hover-outline");
      element.removeAttribute("contenteditable");
      element.removeAttribute("data-hs-original-text");
      element.removeAttribute("data-hs-dyn-patches");
      element.removeAttribute("data-hs-user-script");
      for (const attribute of [...element.attributes]) {
        if (attribute.name.toLowerCase().startsWith("on")) {
          element.removeAttribute(attribute.name);
        }
      }
      const nodeId = element.getAttribute("data-hs-id");
      if (nodeId?.startsWith("dyn_")) {
        element.setAttribute("data-hs-id", `node_${crypto.randomUUID()}`);
        convertedDynamicIds += 1;
      }
    }

    const doctype = document.doctype
      ? `<!doctype ${document.doctype.name}>\n`
      : "<!doctype html>\n";
    postToHost({
      type: "materialized-document",
      html: `${doctype}${clone.outerHTML}`,
      stats: {
        elements: clone.querySelectorAll("*").length,
        convertedDynamicIds,
        canvasSnapshots
      }
    });
  }

  /** Switch the user-inserted chart's type (line/bar/area) and re-render. */
  private changeChartType(chartType: "line" | "bar" | "area" | "pie"): void {
    if (!this.primary || !this.primary.hasAttribute("data-hs-chart")) return;
    try {
      const raw = this.primary.dataset.hsChartData ?? "{}";
      const config: ChartBlockData = { ...getDefaultChartData(), ...JSON.parse(raw) };
      const before = JSON.parse(raw);
      config.type = chartType;
      this.primary.dataset.hsChartData = JSON.stringify(config);
      const echarts = (window as unknown as { echarts?: { getInstanceByDom: (el: HTMLElement) => EChartInstance | undefined } }).echarts;
      const inst = echarts?.getInstanceByDom(this.primary);
      if (inst) {
        inst.setOption(buildEChartsOption(config), { notMerge: false });
        setTimeout(() => inst.resize(), 50);
        // Re-attach drag circles for line/area
        if (chartType === "line" || chartType === "area") {
          const eGlobal = (window as unknown as { echarts?: { util?: { map: <T,R>(a: T[], f: (v: T, i: number) => R) => R[] } } }).echarts;
          if (eGlobal?.util) this.refreshChartDragPoints(this.primary, inst, config, eGlobal);
        } else {
          // Remove drag circles for bar
          inst.setOption({ graphic: [] as unknown as Record<string, unknown>[] });
        }
      }
      // Persist
      this.commit({
        type: "chart.patch",
        chartKey: `hs-chart:${idOf(this.primary)}`,
        before: before as unknown as ChartPatch,
        after: config as unknown as ChartPatch
      });
      this.emitSelection();
      postToHost({ type: "notice", message: `图表已切换为 ${chartType}` });
    } catch (err) {
      console.error("[changeChartType]", err);
    }
  }

  /** Import CSV file → parse → update selected chart's data. */
  private importCsvData(): void {
    if (!this.primary || !this.primary.hasAttribute("data-hs-chart")) {
      postToHost({ type: "notice", message: "请先选中一个图表" });
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) { input.remove(); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = String(reader.result ?? "");
          const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
          if (lines.length < 2) {
            postToHost({ type: "notice", message: "CSV 数据不足（至少 2 行）" });
            return;
          }
          const labels = lines[0]!.split(",").map((s) => s.trim());
          const data: number[] = [];
          for (let i = 1; i < lines.length; i++) {
            const v = parseFloat(lines[i]!.split(",")[0] ?? "0");
            data.push(Number.isFinite(v) ? v : 0);
          }
          // Update via chart-patch
          this.setSelection(this.primary);
          this.commit({
            type: "chart.patch",
            chartKey: `hs-chart:${idOf(this.primary!)}`,
            before: null as unknown as ChartPatch,
            after: {
              data: { labels, series: [{ name: "数据", data }] }
            } as unknown as ChartPatch
          });
          postToHost({ type: "notice", message: `已导入 ${data.length} 行 CSV` });
        } catch (err) {
          console.error("[importCsvData]", err);
          postToHost({ type: "notice", message: "CSV 解析失败" });
        } finally {
          input.remove();
        }
      };
      reader.readAsText(file, "utf-8");
    }, { once: true });
    input.click();
  }

  /** Legacy iframe picker entry point. The host now owns durable imports. */
  private acceptVideo(): void {
    postToHost({ type: "notice", message: "请在右侧视频面板中选择本地视频" });
  }

  private acceptVideoAsset(src: string, title: string): void {
    if (this.primary instanceof HTMLVideoElement) {
      const target = this.primary;
      const before = target.getAttribute("src");
      target.src = src;
      target.title = title;
      target.controls = true;
      target.preload = "metadata";
      target.dataset.hsVideo = "source";
      target.load();
      this.commit({
        type: "attribute.set",
        nodeId: idOf(target),
        name: "src",
        before,
        after: src
      });
      this.emitSelection();
      postToHost({ type: "notice", message: "视频已替换并保存到项目资源" });
      return;
    }

    const parent = (this.primary?.parentElement
      ?? document.querySelector(".page-inner")
      ?? document.body) as HTMLElement;
    if (!idOf(parent) && parent !== document.body) {
      parent.dataset.hsId = `node_${crypto.randomUUID()}`;
    }
    const video = document.createElement("video");
    const nodeId = `node_${crypto.randomUUID()}`;
    video.dataset.hsId = nodeId;
    video.dataset.hsVideo = "source";
    video.src = src;
    video.title = title;
    video.controls = true;
    video.preload = "metadata";
    Object.assign(video.style, {
      display: "block",
      width: "100%",
      maxWidth: "100%",
      minHeight: "180px",
      borderRadius: "6px",
      background: "#000"
    });
    const ref = this.primary?.isConnected ? this.primary.nextSibling : null;
    if (ref) parent.insertBefore(video, ref);
    else parent.appendChild(video);
    const index = [...parent.children].indexOf(video);
    this.commit({
      type: "node.insert",
      parentId: persistedIdOf(parent),
      index,
      node: {
        id: nodeId,
        tagName: "video",
        attributes: {
          src,
          title,
          controls: "",
          preload: "metadata",
          "data-hs-video": "source",
          style: video.getAttribute("style") ?? ""
        },
        text: ""
      }
    });
    this.setSelection(video);
    postToHost({ type: "notice", message: "视频已插入并保存到项目资源" });
  }

  /** GrapesJS TraitManager: set attribute (href/alt/title etc.) */
  private setAttribute(name: string, value: string): void {
    if (!this.primary) return;
    const before = this.primary.getAttribute(name);
    if (value === "") this.primary.removeAttribute(name);
    else this.primary.setAttribute(name, value);
    this.commit({
      type: "attribute.set", nodeId: idOf(this.primary), name, before, after: value === "" ? null : value
    });
    this.emitSelection();
  }

  private onSelectionChange(): void {
    if (!this.primary) {
      this.reportFloatToolbar(false, 0, 0);
      return;
    }
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      if (range.commonAncestorContainer.isConnected) {
        this.savedTextRange = range.cloneRange();
      }
    }
    // Report floating toolbar position regardless of state
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width > 0) {
        this.reportFloatToolbar(true, rect.left + rect.width / 2, rect.top - 12);
      } else {
        const fallback = this.primary.getBoundingClientRect();
        this.reportFloatToolbar(
          true,
          fallback.left + fallback.width / 2,
          fallback.top - 12
        );
      }
    } else {
      this.reportFloatToolbar(false, 0, 0);
    }
    const caretInsidePrimary = Boolean(
      sel?.isCollapsed
      && sel.anchorNode
      && this.primary.contains(sel.anchorNode)
    );
    if (
      this.isTextSelected()
      || this.primary.isContentEditable
      || caretInsidePrimary
    ) {
      this.emitSelection();
    }
  }

  private reportFloatToolbar(visible: boolean, x: number, y: number): void {
    (postToHost as unknown as (m: Record<string, unknown>) => void)({
      type: "text-select-pos", visible, x, y
    });
  }

  private selectionStyleElement(): Element | null {
    const selection = window.getSelection();
    if (!selection?.anchorNode) return null;
    let node: Node | null = selection.anchorNode;
    if (node instanceof Element) {
      const offset = selection.anchorOffset;
      node = node.childNodes.item(offset)
        ?? node.childNodes.item(Math.max(0, offset - 1))
        ?? node;
    }
    return node instanceof Element ? node : node.parentElement;
  }

  /** GrapesJS StyleManager: query current color state for inline formatting */
  private queryColorState(cmd: string): string {
    try {
      const element = this.selectionStyleElement();
      if (element) {
        const computed = getComputedStyle(element);
        const color = cmd === "hiliteColor"
          ? computed.backgroundColor
          : computed.color;
        if (
          color
          && color !== "rgba(0, 0, 0, 0)"
          && color !== "transparent"
        ) {
          return color;
        }
      }
      // document.queryCommandValue returns the current color as a CSS color string
      const val = document.queryCommandValue(cmd);
      if (typeof val === "string" && val && val !== "transparent") {
        return val;
      }
    } catch { /* ignore */ }
    return "";
  }

  /** GrapesJS StyleManager: query current font size */
  private queryFontSizeState(): string {
    try {
      const element = this.selectionStyleElement();
      if (element) {
        const computed = getComputedStyle(element).fontSize;
        if (computed) return computed;
      }
      const val = document.queryCommandValue("fontSize");
      if (typeof val === "string" && val) return val;
    } catch { /* ignore */ }
    return "";
  }

  private previewTextStyle(property: string, value: string): void {
    try {
      if (this.textStylePreview?.property === property) {
        this.textStylePreview.span.style.setProperty(property, value);
        this.emitSelection();
        return;
      }
      if (this.textStylePreview) {
        const current = this.textStylePreview;
        this.commitTextStylePreview(
          current.property,
          current.span.style.getPropertyValue(current.property)
        );
      }
      const selection = window.getSelection();
      if (!selection) return;
      const liveRange = selection.rangeCount > 0 && !selection.isCollapsed
        ? selection.getRangeAt(0)
        : null;
      const range = liveRange?.commonAncestorContainer.isConnected
        ? liveRange.cloneRange()
        : this.savedTextRange?.commonAncestorContainer.isConnected
          ? this.savedTextRange.cloneRange()
          : null;
      if (!range || range.collapsed) return;

      const rangeElement = range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
      const host = persistentAnchorOf(rangeElement);
      if (!host || host === document.body || !idOf(host)) return;

      selection.removeAllRanges();
      selection.addRange(range);
      const beforeHtml = host.innerHTML;
      const span = this.wrapSelectedText(property, value);
      this.textStylePreview = { host, span, property, beforeHtml };
      this.setSelection(host);
    } catch (error) {
      console.error("[previewTextStyle]", error);
    }
  }

  private commitTextStylePreview(property: string, value: string): void {
    const preview = this.textStylePreview;
    if (!preview || preview.property !== property) {
      this.applyTextStyle(property, value);
      return;
    }
    preview.span.style.setProperty(property, value);
    const afterHtml = preview.host.innerHTML;
    this.textStylePreview = null;
    if (afterHtml !== preview.beforeHtml) {
      this.commit({
        type: "text.patchStyle",
        nodeId: idOf(preview.host),
        before: preview.beforeHtml,
        after: afterHtml
      });
    }
    const selection = window.getSelection();
    if (
      selection
      && selection.rangeCount > 0
      && !selection.isCollapsed
    ) {
      this.savedTextRange = selection.getRangeAt(0).cloneRange();
    }
    this.setSelection(preview.host);
  }

  private applyTextStyle(property: string, value: string): void {
    try {
      const sel = window.getSelection();
      if (!sel) return;
      const liveRange = sel.rangeCount > 0 && !sel.isCollapsed
        ? sel.getRangeAt(0)
        : null;
      const range = liveRange?.commonAncestorContainer.isConnected
        ? liveRange.cloneRange()
        : this.savedTextRange?.commonAncestorContainer.isConnected
          ? this.savedTextRange.cloneRange()
          : null;
      if (!range) {
        postToHost({ type: "notice", message: "请先选中要格式化的文字" });
        return;
      }
      if (range.toString().trim().length === 0 && range.collapsed) {
        // Cursor at empty position — nothing to style yet (user will type next)
        postToHost({ type: "notice", message: "请先选中要格式化的文字" });
        return;
      }
      const rangeElement = range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
      const host = persistentAnchorOf(rangeElement);
      if (!host || host === document.body || !idOf(host)) return;
      const beforeHtml = host.innerHTML;
      const beforeRect = host.getBoundingClientRect();
      // Save which element to keep selected after the change
      const keepSelected = host;

      // Use execCommand — handles selection spanning nodes, produces semantic markup.
      const wasCe = host.isContentEditable;
      if (!wasCe) host.contentEditable = "true";
      host.focus();
      sel.removeAllRanges();
      sel.addRange(range);
      let cmd = "";
      let cmdValue = "";
      let useExactWrapper = false;
      switch (property) {
        case "font-weight": cmd = "bold"; break;
        case "font-style": cmd = "italic"; break;
        case "text-decoration": cmd = "underline"; break;
        case "color": cmd = "foreColor"; cmdValue = value; break;
        case "background-color": cmd = "hiliteColor"; cmdValue = value; break;
        // execCommand fontSize accepts only legacy values 1-7, so 32px and
        // 48px can collapse to the same result. Wrap the exact CSS value.
        case "font-size": useExactWrapper = true; break;
      }
      let ok = false;
      if (useExactWrapper) {
        try {
          this.wrapSelectedText(property, value);
          ok = true;
        } catch {
          ok = false;
        }
      } else {
        try {
          if (cmd) ok = document.execCommand(cmd, false, cmdValue);
        } catch (err) {
          console.error("[applyTextStyle] execCommand failed:", err);
          ok = false;
        }
      }
      if (!ok) {
        try { this.wrapSelectedText(property, value); ok = true; }
        catch { ok = false; }
      }

      // SAFETY: detect if element became 0×0 (the freeze symptom) and recover
      const afterRect = keepSelected.getBoundingClientRect();
      if (afterRect.width === 0 || afterRect.height === 0) {
        console.warn("[applyTextStyle] element collapsed to 0×0, recovering");
        keepSelected.innerHTML = beforeHtml;
        if (!wasCe) keepSelected.removeAttribute("contenteditable");
        this.setSelection(null);
        postToHost({ type: "notice", message: "样式应用失败，元素已恢复" });
        return;
      }

      if (!wasCe) keepSelected.removeAttribute("contenteditable");

      if (!ok) {
        postToHost({ type: "notice", message: "样式应用失败" });
        return;
      }
      const afterHtml = keepSelected.innerHTML;
      if (afterHtml === beforeHtml) return;
      this.commit({
        type: "text.patchStyle",
        nodeId: idOf(keepSelected),
        before: beforeHtml,
        after: afterHtml
      });
      const updatedSelection = window.getSelection();
      if (
        updatedSelection
        && updatedSelection.rangeCount > 0
        && !updatedSelection.isCollapsed
      ) {
        this.savedTextRange = updatedSelection.getRangeAt(0).cloneRange();
      }
      // Re-establish selection on the element so the user can keep editing
      this.setSelection(keepSelected);
    } catch (err) {
      console.error("[applyTextStyle]", err);
    }
  }

  private wrapSelectedText(property: string, value: string): HTMLSpanElement {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      throw new Error("No active text range");
    }
    const range = sel.getRangeAt(0);
    const span = document.createElement("span");
    span.style.setProperty(property, value);
    try {
      range.surroundContents(span);
    } catch {
      const fragment = range.extractContents();
      span.appendChild(fragment);
      range.insertNode(span);
    }
    const updatedRange = document.createRange();
    updatedRange.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(updatedRange);
    this.savedTextRange = updatedRange.cloneRange();
    return span;
  }
}

new EditorRuntime().start();
