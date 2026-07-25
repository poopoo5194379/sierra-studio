import type { CommandPayload, StyleDeclaration } from "../domain/commands/schema";
import {
  explicitDeclaration,
  idOf,
  inlineDeclaration,
  isDynamicId,
  isRepeatedComponent,
  selectionFor
} from "./dom";
import { DynamicNodeManager, DYNAMIC_PATCH_ATTRIBUTE } from "./dynamic-nodes";
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
import type { ChartPatch } from "./charts/types";

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

type DragState = FlowDrag | FreeDrag | ResizeDrag | PendingDrag;
type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom";
const GEOMETRY_PROPERTIES = [
  "position", "left", "top", "width", "height", "margin"
] as const;

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

// execCommand("fontSize", _, value) expects 1-7. Map px sizes to legacy scale.
function parseFontSizeValue(value: string): number {
  const m = /(\d+(?:\.\d+)?)/.exec(value);
  if (!m) return 3;
  const px = parseFloat(m[1]!);
  if (px <= 10) return 1;
  if (px <= 13) return 2;
  if (px <= 17) return 3;
  if (px <= 19) return 4;
  if (px <= 23) return 5;
  if (px <= 29) return 6;
  return 7;
}

// ---- Phase 6: Chart Block helpers ----

interface ChartBlockData {
  type: "line" | "bar" | "area" | "pie";
  xAxis: string[];
  series: Array<{ name: string; data: number[] }>;
  color: string;
  title?: string;
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
  if (config.type === "pie") {
    const s = config.series[0];
    const pieData = s
      ? (config.xAxis).map((label: string, i: number) => ({
        name: label,
        value: s.data[i] ?? 0
      }))
      : [];
    return {
      tooltip: { trigger: "item" },
      title: config.title ? { text: config.title, left: "center", textStyle: { fontSize: 13 } } : undefined,
      legend: { bottom: 0, type: "scroll" },
      series: [{
        type: "pie",
        radius: ["30%", "70%"],
        center: ["50%", "50%"],
        data: pieData,
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: "rgba(0,0,0,0.3)" } },
        color: pieData.map((_: unknown, i: number) => {
          const colors = ["#4f7cff","#36b37e","#ff8f73","#ffc440","#8b5cf6","#0ea5e9"];
          return colors[i % colors.length];
        })
      }]
    };
  }
  // line/bar/area code stays the same
  const seriesType = config.type === "area" ? "line" : config.type;
  return {
    tooltip: { trigger: "axis" },
    grid: { left: 40, right: 20, top: config.title ? 40 : 30, bottom: 40 },
    title: config.title ? { text: config.title, left: 10, top: 5, textStyle: { fontSize: 13, fontWeight: "normal" } } : undefined,
    xAxis: { type: "category", data: config.xAxis, boundaryGap: seriesType === "bar" },
    yAxis: { type: "value" },
    series: config.series.map((s) => ({
      type: seriesType,
      name: s.name,
      data: s.data,
      smooth: seriesType === "line",
      symbol: "circle",
      symbolSize: 10,
      areaStyle: config.type === "area" ? { opacity: 0.3 } : undefined,
      itemStyle: { color: config.color },
      lineStyle: { color: config.color, width: 2 }
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
  // Track pointer-down state to distinguish click from drag
  private pointerDown: { x: number; y: number; target: HTMLElement; dragMoved: boolean } | null = null;
  private contentEditable: HTMLElement | null = null;
  private lastMouseWasDrag = false;

  start(): void {
    this.installEditorEnvironment();
    this.dynamicNodes.start();
    window.addEventListener("scroll", () => this.updateOverlay(), true);
    window.addEventListener("resize", () => this.updateOverlay());
    window.addEventListener("message", (event) => this.onHostMessage(event));
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
      img {
        -webkit-user-drag: none;
        user-select: none;
      }
      /* GrapesJS-style hover outline */
      .hs-hover-outline {
        outline: 1px dashed rgba(79,124,255,0.55) !important;
        outline-offset: 2px !important;
      }
    `;
    (document.head ?? document.documentElement).appendChild(style);
  }

  private selectionElements(): HTMLElement[] {
    return [...this.selected].filter((element) => element.isConnected);
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
      isComponent: isRepeatedComponent(primary),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      text: primary.textContent ?? "",
      canEditText: !chart && primary.tagName !== "IMG",
      borderRadius: computed.borderRadius,
      backgroundColor: computed.backgroundColor,
      ...(primary.tagName === "IMG" && primary instanceof HTMLImageElement
        ? { imageSrc: primary.src }
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
    // GrapesJS StyleManager: live text formatting state
    if (selection.hasTextSelection || primary.isContentEditable) {
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
      }
    } else if (!additive) {
      this.primary = null;
    }
    this.emitSelection();
  }

  private enterContentEditable(target: HTMLElement): void {
    if (this.contentEditable && this.contentEditable !== target) {
      this.commitContentEditable();
    }
    if (target.tagName === "IMG") return;
    this.setSelection(target);
    this.contentEditable = target;
    // Save original text for later comparison
    const before = target.textContent ?? "";
    target.dataset.hsOriginalText = before;
    target.contentEditable = "true";
    target.focus();
    const range = document.createRange();
    range.selectNodeContents(target);
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
    const before = target.dataset.hsOriginalText ?? target.textContent ?? "";
    const after = target.textContent ?? "";
    delete target.dataset.hsOriginalText;
    target.removeAttribute("contenteditable");
    this.contentEditable = null;
    if (after !== before) {
      this.commit({
        type: "text.set",
        nodeId: idOf(target),
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
    for (const converted of this.dynamicNodes.convert(payload)) {
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
            this.dynamicNodes.replay();
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
          newNode.textContent = payload.node.text;
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
          // The host's command is already converted; we update the
          // registry from the manifest the host just wrote.
          this.charts.restoreOverrides();
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
    return document.querySelector<HTMLElement>(
      `[data-hs-id="${CSS.escape(nodeId)}"]`
    );
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
    this.setSelection(selectable, event.shiftKey || event.ctrlKey || event.metaKey);
  }

  private onDoubleClick(event: MouseEvent): void {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-hs-id]")
      : null;
    if (!target || target.tagName === "IMG") return;
    const chartHandle = this.charts.find(
      event.target instanceof Element ? event.target : null
    );
    if (chartHandle && chartHandle.element === target) return;
    event.preventDefault();
    event.stopPropagation();
    this.pointerDown = null;
    // Enter edit mode on the target element directly
    this.enterContentEditable(target);
  }

  private onContextMenu(event: MouseEvent): void {
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
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
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
    if (["absolute", "fixed"].includes(computed.position)) {
      const movable = this.selectionElements().filter(c =>
        ["absolute", "fixed"].includes(getComputedStyle(c).position)
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
    } else if (isRepeatedComponent(element) && !isDynamicId(idOf(element))) {
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
    // Escape: exit text edit, or deselect
    if (event.key === "Escape") {
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
      case "convert-free":
        this.convertToLocalFree();
        break;
      case "set-text":
        this.setText(message.text);
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
      case "image":
        this.acceptImage(message.path);
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
        if (this.primary && this.primary.tagName !== "IMG") this.enterContentEditable(this.primary);
        break;
      case "toggle-symbol":
        this.toggleSymbol();
        break;
      case "select-next-sibling":
        this.selectNextSibling(message.forward);
        break;
      case "insert-block":
        this.insertBlock(message.blockType);
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
        if (patch.primaryColor !== undefined) config.color = patch.primaryColor;
        if (patch.data) {
          if (patch.data.labels) config.xAxis = patch.data.labels as string[];
          if (patch.data.series[0]) {
            config.series = config.series.map((s, i) => ({
              ...s,
              ...(patch.data!.series[i] ? { data: patch.data!.series[i]!.data as number[] } : {})
            }));
          }
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

  private setText(text: string): void {
    if (!this.primary || this.primary.tagName === "IMG") return;
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
    const parentStyle = getComputedStyle(parent);
    const changes: Extract<CommandPayload, { type: "styles.set" }>["nodes"] = [];
    if (parentStyle.position === "static") {
      const before = inlineDeclaration(parent, "position");
      parent.style.position = "relative";
      changes.push({
        nodeId: idOf(parent),
        before: [before],
        after: [explicitDeclaration("position", "relative")]
      });
    }
    elements.forEach((element, index) => {
      const rect = rects[index]!;
      const before = GEOMETRY_PROPERTIES.map((property) =>
        inlineDeclaration(element, property)
      );
      const declarations = [
        explicitDeclaration("position", "absolute"),
        explicitDeclaration(
          "left",
          `${rect.left - parentRect.left
            - (parseFloat(parentStyle.borderLeftWidth) || 0)
            + parent.scrollLeft}px`
        ),
        explicitDeclaration(
          "top",
          `${rect.top - parentRect.top
            - (parseFloat(parentStyle.borderTopWidth) || 0)
            + parent.scrollTop}px`
        ),
        explicitDeclaration("width", `${rect.width}px`),
        explicitDeclaration("height", `${rect.height}px`),
        explicitDeclaration("margin", "0px")
      ];
      for (const declaration of declarations) {
        element.style.setProperty(declaration.property, declaration.value);
      }
      changes.push({ nodeId: idOf(element), before, after: declarations });
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

  private alignSelection(alignment: Alignment): void {
    const elements = this.selectionElements();
    if (elements.length < 2) {
      postToHost({ type: "notice", message: "请用 Shift 或 Ctrl 选择至少两个对象" });
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
    for (const element of elements) {
      const parent = element.parentElement;
      if (!parent?.isConnected) continue;
      const index = [...parent.children].indexOf(element);
      const tagName = element.tagName.toLowerCase() as "img" | "div" | "p" | "span";
      const attributes: Record<string, string> = {};
      const style = element.getAttribute("style");
      if (style) attributes.style = style;
      if (tagName === "img" && element instanceof HTMLImageElement) {
        attributes.src = element.src;
        attributes.alt = element.alt || "";
      }
      element.remove();
      this.commit({
        type: "node.delete",
        nodeId: idOf(element),
        parentId: idOf(parent),
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

  private copySelected(): void {
    const elements = this.selectionElements();
    if (elements.length === 0) return;
    try {
      const snapshots = elements.map((element) => {
        const tag = element.tagName.toLowerCase() as "img" | "div" | "p" | "span";
        const attrs: Record<string, string> = {};
        const style = element.getAttribute("style");
        if (style) attrs.style = style;
        if (tag === "img" && element instanceof HTMLImageElement) {
          attrs.src = element.src;
          attrs.alt = element.alt || "";
        }
        if (element.id) attrs.id = element.id;
        if (element.className) attrs.className = element.className;
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
        tagName: "img" | "div" | "p" | "span";
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
          parentId: idOf(parent),
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
    const newId = `node_${crypto.randomUUID()}`;
    clone.dataset.hsId = newId;
    clone.removeAttribute("contenteditable");
    clone.removeAttribute("data-hs-dyn-patches");
    clone.removeAttribute("data-hs-chart-stable-id");
    source.parentElement?.insertBefore(clone, source.nextSibling);
    const parent = source.parentElement!;
    const index = [...parent.children].indexOf(clone);
    this.commit({
      type: "node.insert",
      parentId: idOf(parent),
      index: index >= 0 ? index : parent.children.length - 1,
      node: { id: newId, tagName: (["img","div","p","span"].includes(source.tagName.toLowerCase()) ? source.tagName.toLowerCase() : "div") as "img"|"div"|"p"|"span", attributes: {}, text: "" }
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
      const computed = getComputedStyle(el);
      if (!["absolute", "fixed"].includes(computed.position)) continue;
      const beforeLeft = inlineDeclaration(el, "left");
      const beforeTop = inlineDeclaration(el, "top");
      const newLeft = parseFloat(computed.left) + dx;
      const newTop = parseFloat(computed.top) + dy;
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

  /** GrapesJS BlockManager: insert a pre-built block into the page. */
  private insertBlock(blockType: string): void {
    try {
      const BLOCKS: Record<string, () => HTMLElement> = {
        h1: () => { const el = document.createElement("h1"); el.textContent = "标题一"; el.style.cssText = "min-height:24px;margin:8px 0;color:inherit"; return el; },
        h2: () => { const el = document.createElement("h2"); el.textContent = "标题���"; el.style.cssText = "min-height:20px;margin:8px 0;color:inherit"; return el; },
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
          // Video placeholder — user can replace via image import flow
          const el = document.createElement("div");
          el.dataset.hsVideo = "placeholder";
          el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:160px;border:1px dashed #4f7cff80;border-radius:6px;background:#f8faff;color:#4f7cff;font-size:13px;">▶ 视频占位 — 双击替换</div>';
          Object.assign(el.style, { minHeight: "160px", margin: "8px 0" });
          return el;
        }
      };

      const factory = BLOCKS[blockType];
      if (!factory) return;

      const el = factory();
      const nodeId = `node_${crypto.randomUUID()}`;
      el.dataset.hsId = nodeId;
      // Phase 12: default absolute positioning for free-form editing (GrapesJS pattern)
      if (!el.style.cssText.includes("position")) {
        const scrollY = window.scrollY;
        el.style.cssText += `;position:absolute;left:20px;top:${scrollY + 40}px;min-width:120px;min-height:28px;z-index:10;background:rgba(255,255,255,0.95);box-shadow:0 1px 4px rgba(0,0,0,0.08);border-radius:4px`;
      }
      // Make freshly-inserted blocks stand out: left highlight + padding
      const hasExplicitStyle = el.hasAttribute("style") && el.style.cssText.length > 50;
      if (!hasExplicitStyle) {
        el.style.cssText += ";min-height:20px;margin:4px 0;padding:4px 0;border-left:3px solid rgba(79,124,255,0.3);padding-left:8px";
      }

      let parent: HTMLElement;
      let ref: Node | null = null;
      if (this.primary?.isConnected && this.primary.parentElement
          && this.primary.parentElement !== document.body) {
        parent = this.primary.parentElement;
        ref = this.primary.nextSibling;
      } else {
        // GrapesJS-style: find a meaningful container, NEVER body
        const pageInner = document.querySelector<HTMLElement>(".page-inner");
        const page = document.querySelector<HTMLElement>(".page");
        if (pageInner) {
          parent = pageInner;
        } else if (page) {
          parent = page;
        } else {
          // Reuse or create a dedicated editor root
          let root = document.getElementById("hs-canvas-root");
          if (!root) {
            root = document.createElement("div");
            root.id = "hs-canvas-root";
            root.style.cssText = "min-height: 200px; padding: 16px; box-sizing: border-box;";
            (document.querySelector("main, #app, .canvas, body")
              ?? document.body).appendChild(root);
          }
          parent = root;
        }
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
      const validTags = ["img","div","p","span","h1","h2","h3","hr","button"];
      this.commit({
        type: "node.insert",
        parentId: idOf(parent),
        index: index >= 0 ? index : parent.children.length - 1,
        node: {
          id: nodeId,
          tagName: (validTags.includes(tag) ? tag : "div") as "img"|"div"|"p"|"span"|"h1"|"h2"|"h3"|"hr"|"button",
          attributes: { style: el.getAttribute("style") ?? "" },
          text: tag === "img" ? "" : (el.textContent ?? "")
        }
      });
      this.setSelection(el);
      // Scroll the new block into view
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // If it's a chart, spark initialization
      if (blockType === "chart") {
        window.setTimeout(() => this.initChartElements(), 100);
      }
      postToHost({ type: "notice", message: `已插入 ${blockType}` });
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
    if (!this.primary) return;
    const current = parseInt(getComputedStyle(this.primary).zIndex, 10) || 0;
    const before = inlineDeclaration(this.primary, "z-index");
    const newZ = Math.max(0, current + delta);
    this.primary.style.zIndex = String(newZ);
    this.commit({
      type: "styles.set",
      nodes: [{ nodeId: idOf(this.primary), before: [before],
        after: [explicitDeclaration("z-index", String(newZ))] }]
    });
    this.emitSelection();
  }

  /** GrapesJS LayerManager: tree of all [data-hs-id] elements */
  private reportLayers(): void {
    const seen = new Set<string>();
    function walk(el: Element): LayerNode[] {
      const nodes: LayerNode[] = [];
      for (const child of el.children) {
        if (child instanceof HTMLElement && child.dataset.hsOverlay) continue;
        const id = child instanceof HTMLElement ? child.getAttribute("data-hs-id") : null;
        if (!id) { nodes.push(...walk(child)); continue; }
        if (seen.has(id)) continue;
        seen.add(id);
        nodes.push({
          id, tag: child.tagName.toLowerCase(),
          text: child.textContent?.trim().slice(0, 40) ?? child.tagName.toLowerCase(),
          children: walk(child)
        });
      }
      return nodes;
    }
    (postToHost as unknown as (m: Record<string, unknown>) => void)({
      type: "layers", layers: walk(document.body).slice(0, 200)
    });
  }

  /** Phase 7: return the full document source HTML for the code viewer. */
  private reportSource(): void {
    const html = "<!doctype html>\n" + document.documentElement.outerHTML;
    (postToHost as unknown as (m: Record<string, unknown>) => void)({
      type: "source-code", html
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

  /** Replace the video placeholder with a real <video> element using a data URL. */
  private acceptVideo(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/mp4,video/webm,video/ogg";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) { input.remove(); return; }
      const url = URL.createObjectURL(file);
      this.insertVideo(url, file.name);
      input.remove();
    }, { once: true });
    input.click();
  }

  /** Insert a <video> element as the primary element. */
  private insertVideo(src: string, title: string): void {
    const el = document.createElement("video");
    el.src = src;
    el.controls = true;
    el.title = title;
    el.dataset.hsVideo = "src";
    el.style.maxWidth = "100%";
    el.style.borderRadius = "6px";
    el.style.background = "#000";
    const parent = (this.primary?.parentElement
      ?? document.querySelector(".page-inner")
      ?? document.body) as HTMLElement;
    if (!idOf(parent)) parent.dataset.hsId = `node_${crypto.randomUUID()}`;
    if (this.primary?.isConnected) {
      this.primary.replaceWith(el);
    } else {
      parent.appendChild(el);
    }
    const nodeId = `node_${crypto.randomUUID()}`;
    el.dataset.hsId = nodeId;
    this.commit({
      type: "node.insert",
      parentId: idOf(parent),
      index: [...parent.children].indexOf(el),
      node: { id: nodeId, tagName: "div", attributes: { "data-hs-video": "src" }, text: title }
    });
    this.setSelection(el);
    postToHost({ type: "notice", message: "视频已插入" });
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
    // Report floating toolbar position regardless of state
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width > 0) {
        this.reportFloatToolbar(true, rect.left + rect.width / 2, rect.top - 12);
      } else {
        this.reportFloatToolbar(false, 0, 0);
      }
    } else {
      this.reportFloatToolbar(false, 0, 0);
    }
    if (this.isTextSelected() || this.primary.isContentEditable) {
      this.emitSelection();
    }
  }

  private reportFloatToolbar(visible: boolean, x: number, y: number): void {
    (postToHost as unknown as (m: Record<string, unknown>) => void)({
      type: "text-select-pos", visible, x, y
    });
  }

  /** GrapesJS StyleManager: query current color state for inline formatting */
  private queryColorState(cmd: string): string {
    try {
      // document.queryCommandValue returns the current color as a CSS color string
      const val = document.queryCommandValue(cmd);
      if (typeof val === "string" && val && val !== "rgb(0, 0, 0)" && val !== "transparent") {
        return val;
      }
    } catch { /* ignore */ }
    return "";
  }

  /** GrapesJS StyleManager: query current font size */
  private queryFontSizeState(): string {
    try {
      const val = document.queryCommandValue("fontSize");
      if (typeof val === "string" && val) return val;
    } catch { /* ignore */ }
    return "";
  }

  private applyTextStyle(property: string, value: string): void {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (range.toString().trim().length === 0 && range.collapsed) {
        // Cursor at empty position — nothing to style yet (user will type next)
        postToHost({ type: "notice", message: "请先选中要格式化的文字" });
        return;
      }
      let host: Node | null = range.commonAncestorContainer;
      while (host && host !== document.body) {
        if (host instanceof HTMLElement && idOf(host)) break;
        host = host instanceof HTMLElement ? host.parentElement : host.parentNode;
      }
      if (!(host instanceof HTMLElement) || !idOf(host)) return;
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
      switch (property) {
        case "font-weight": cmd = "bold"; break;
        case "font-style": cmd = "italic"; break;
        case "text-decoration": cmd = "underline"; break;
        case "color": cmd = "foreColor"; cmdValue = value; break;
        case "background-color": cmd = "hiliteColor"; cmdValue = value; break;
        case "font-size": cmd = "fontSize"; cmdValue = String(parseFontSizeValue(value)); break;
      }
      let ok = false;
      try {
        if (cmd) ok = document.execCommand(cmd, false, cmdValue);
      } catch (err) {
        console.error("[applyTextStyle] execCommand failed:", err);
        ok = false;
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
      // Re-establish selection on the element so the user can keep editing
      this.setSelection(keepSelected);
    } catch (err) {
      console.error("[applyTextStyle]", err);
    }
  }

  private wrapSelectedText(property: string, value: string): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
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
  }
}

new EditorRuntime().start();
