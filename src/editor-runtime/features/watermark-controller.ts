import type { CommandPayload } from "../../domain/commands/schema";
import {
  applyWatermarksToDocument,
  createWatermarkSettings,
  parseWatermarkSettings,
  readWatermarkSettings,
  type LegacyWatermarkCandidate,
  type WatermarkAnchor,
  type WatermarkSettings
} from "../../domain/watermarks/watermark-model";

const PX_TO_MM = 25.4 / 96;

function candidateSelector(image: HTMLImageElement): string | null {
  const semantic = [...image.classList].find((name) =>
    /watermark|logo|水印/i.test(name)
  );
  if (semantic && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(semantic)) {
    return `.${semantic}`;
  }
  if (
    image.id
    && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(image.id)
    && /watermark|logo|水印/i.test(image.id)
  ) {
    return `#${image.id}`;
  }
  return null;
}

function geometryFor(image: HTMLImageElement): {
  anchor: WatermarkAnchor;
  offsetXmm: number;
  offsetYmm: number;
} {
  const page = image.closest<HTMLElement>(
    "[data-page-id],[data-a4-page],.a4-editor-page,.print-page,.page,.slide"
  ) ?? image.parentElement ?? document.body;
  const pageRect = page.getBoundingClientRect();
  const rect = image.getBoundingClientRect();
  const horizontalDistances = {
    left: Math.abs(rect.left - pageRect.left),
    center: Math.abs(
      rect.left + rect.width / 2 - (pageRect.left + pageRect.width / 2)
    ),
    right: Math.abs(pageRect.right - rect.right)
  };
  const verticalDistances = {
    top: Math.abs(rect.top - pageRect.top),
    middle: Math.abs(
      rect.top + rect.height / 2 - (pageRect.top + pageRect.height / 2)
    ),
    bottom: Math.abs(pageRect.bottom - rect.bottom)
  };
  const horizontal = (
    Object.entries(horizontalDistances) as Array<
      [keyof typeof horizontalDistances, number]
    >
  ).sort((left, right) => left[1] - right[1])[0]![0];
  const vertical = (
    Object.entries(verticalDistances) as Array<
      [keyof typeof verticalDistances, number]
    >
  ).sort((left, right) => left[1] - right[1])[0]![0];
  const offsetX = horizontalDistances[horizontal];
  const offsetY = verticalDistances[vertical];
  const anchor = horizontal === "center" && vertical === "middle"
    ? "center"
    : `${vertical}-${horizontal}` as WatermarkAnchor;
  return {
    anchor,
    offsetXmm: Math.round(offsetX * PX_TO_MM * 10) / 10,
    offsetYmm: Math.round(offsetY * PX_TO_MM * 10) / 10
  };
}

function legacyPages(): HTMLElement[] {
  for (const selector of [
    "[data-page-id]",
    "[data-a4-page]",
    ".a4-editor-page",
    ".print-page",
    ".page",
    ".slide"
  ]) {
    const pages = [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((page) => !page.closest("[data-hs-watermark-layer]"));
    if (pages.length > 1) return pages;
  }
  return [];
}

function pseudoOwnerSelector(element: HTMLElement): string | null {
  for (const className of [
    "slide",
    "page",
    "print-page",
    "a4-editor-page"
  ]) {
    if (element.classList.contains(className)) return `.${className}`;
  }
  const semantic = [...element.classList].find((name) =>
    /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)
  );
  return semantic ? `.${semantic}` : null;
}

function backgroundImageSource(value: string): string | null {
  const match = value.trim().match(/^url\((?:"([\s\S]*)"|'([\s\S]*)'|([^)]*))\)$/i);
  return (match?.[1] ?? match?.[2] ?? match?.[3])?.trim() || null;
}

function pixelValue(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export class WatermarkController {
  private current: WatermarkSettings;
  private previewBefore: WatermarkSettings | null = null;
  private active: { id: string; instance: number } | null = null;
  private drag: {
    mode: "move" | "resize";
    id: string;
    startX: number;
    startY: number;
    resizeSide: "left" | "right";
    base: WatermarkSettings;
    latest: WatermarkSettings;
    moved: boolean;
  } | null = null;

  constructor(
    private readonly commitCommand: (payload: CommandPayload) => void,
    private readonly selectWatermark: (id: string) => void,
    private readonly settingsChanged: (settings: WatermarkSettings) => void
  ) {
    this.current = readWatermarkSettings(document)
      ?? createWatermarkSettings();
    window.addEventListener(
      "pointermove",
      (event) => this.onPointerMove(event),
      true
    );
    window.addEventListener(
      "pointerup",
      () => this.onPointerUp(),
      true
    );
  }

  private apply(settings: WatermarkSettings): void {
    applyWatermarksToDocument(document, settings);
    this.bindInteractions();
  }

  private bindInteractions(): void {
    const instances = new Map<string, number>();
    for (const mark of document.querySelectorAll<HTMLElement>(
      "[data-hs-watermark-id]"
    )) {
      const markId = mark.getAttribute("data-hs-watermark-id") ?? "";
      const instance = instances.get(markId) ?? 0;
      instances.set(markId, instance + 1);
      mark.onpointerdown = (event): void => {
        if (event.button !== 0) return;
        const id = mark.getAttribute("data-hs-watermark-id");
        const base = readWatermarkSettings(document);
        if (!id || !base?.items.some((item) => item.id === id)) return;
        const handle = event.target instanceof Element
          ? event.target.closest<HTMLElement>(
            "[data-hs-watermark-resize-handle]"
          )
          : null;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.selectWatermark(id);
        this.active = { id, instance };
        if (!handle) this.decorateActiveMark();
        this.drag = {
          mode: handle ? "resize" : "move",
          id,
          startX: event.clientX,
          startY: event.clientY,
          resizeSide: handle?.dataset.side === "left" ? "left" : "right",
          base: structuredClone(base),
          latest: structuredClone(base),
          moved: false
        };
      };
    }
    this.decorateActiveMark();
  }

  private decorateActiveMark(): void {
    for (const mark of document.querySelectorAll<HTMLElement>(
      "[data-hs-watermark-active]"
    )) {
      mark.removeAttribute("data-hs-watermark-active");
      mark.querySelector("[data-hs-watermark-resize-handle]")?.remove();
    }
    if (!this.active) return;
    const matching = [
      ...document.querySelectorAll<HTMLElement>(
        `[data-hs-watermark-id="${CSS.escape(this.active.id)}"]`
      )
    ];
    const mark = matching[this.active.instance];
    const item = this.current.items.find((candidate) =>
      candidate.id === this.active!.id
    );
    if (!mark || !item) return;
    mark.setAttribute("data-hs-watermark-active", "");
    if (item.repeat) return;
    const handle = document.createElement("span");
    const side = item.anchor.endsWith("right") ? "left" : "right";
    handle.setAttribute("data-hs-watermark-resize-handle", "");
    handle.setAttribute("data-side", side);
    handle.setAttribute("aria-hidden", "true");
    mark.append(handle);
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.drag) return;
    const dx = event.clientX - this.drag.startX;
    const dy = event.clientY - this.drag.startY;
    if (!this.drag.moved && Math.hypot(dx, dy) < 2) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.drag.moved = true;
    this.previewBefore ??= structuredClone(this.current);
    const item = this.drag.base.items.find(
      (candidate) => candidate.id === this.drag!.id
    );
    if (!item) return;
    const horizontalSign = item.anchor.endsWith("right") ? -1 : 1;
    const verticalSign = item.anchor.startsWith("bottom") ? -1 : 1;
    const next: WatermarkSettings = {
      ...this.drag.base,
      items: this.drag.base.items.map((candidate) =>
        candidate.id === this.drag!.id
          ? this.drag!.mode === "resize"
            ? {
              ...candidate,
              widthMm: Math.round(
                Math.min(
                  300,
                  Math.max(
                    2,
                    candidate.widthMm
                    + dx * PX_TO_MM
                    * (this.drag!.resizeSide === "left" ? -1 : 1)
                  )
                ) * 10
              ) / 10
            }
            : {
              ...candidate,
              offsetXmm: Math.round(
                Math.max(
                  0,
                  candidate.offsetXmm
                  + dx * PX_TO_MM * horizontalSign
                ) * 10
              ) / 10,
              offsetYmm: Math.round(
                Math.max(
                  0,
                  candidate.offsetYmm
                  + dy * PX_TO_MM * verticalSign
                ) * 10
              ) / 10
            }
          : candidate
      )
    };
    this.drag.latest = next;
    this.apply(next);
  }

  private onPointerUp(): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag?.moved) return;
    this.commit(drag.latest);
    this.settingsChanged(structuredClone(this.current));
  }

  sync(value: WatermarkSettings): void {
    this.previewBefore = null;
    this.current = parseWatermarkSettings(value);
    this.apply(this.current);
  }

  preview(value: WatermarkSettings): void {
    this.previewBefore ??= structuredClone(this.current);
    this.apply(parseWatermarkSettings(value));
  }

  commit(value: WatermarkSettings): void {
    const after = parseWatermarkSettings(value);
    const before = this.previewBefore ?? structuredClone(this.current);
    this.previewBefore = null;
    this.current = structuredClone(after);
    this.apply(after);
    this.commitCommand({
      type: "watermarks.set",
      before,
      after
    });
  }

  cancelPreview(): void {
    if (!this.previewBefore) return;
    this.apply(this.previewBefore);
    this.current = this.previewBefore;
    this.previewBefore = null;
  }

  applyFromHistory(value: WatermarkSettings): void {
    this.previewBefore = null;
    this.current = parseWatermarkSettings(value);
    this.apply(this.current);
  }

  detectLegacyCandidates(): LegacyWatermarkCandidate[] {
    const groups = new Map<string, HTMLImageElement[]>();
    for (const image of document.querySelectorAll<HTMLImageElement>("img")) {
      if (image.closest("[data-hs-watermark-layer]")) continue;
      const selector = candidateSelector(image);
      const descriptor = [
        image.id,
        image.className,
        image.alt,
        image.getAttribute("aria-label") ?? ""
      ].join(" ");
      if (!selector && !/watermark|logo|水印/i.test(descriptor)) continue;
      const source = image.currentSrc || image.src;
      if (!source) continue;
      const key = `${selector ?? ""}\n${source}`;
      const group = groups.get(key) ?? [];
      group.push(image);
      groups.set(key, group);
    }

    const candidates: LegacyWatermarkCandidate[] = [];
    for (const images of groups.values()) {
      if (images.length < 2) continue;
      const first = images[0]!;
      const selector = candidateSelector(first);
      if (!selector) continue;
      const rect = first.getBoundingClientRect();
      const style = getComputedStyle(first);
      const geometry = geometryFor(first);
      if (rect.width < 12 || rect.height < 4) continue;
      const source = first.currentSrc || first.src;
      candidates.push({
        selector,
        source,
        count: images.length,
        name: /logo/i.test(selector) ? "重复 Logo" : "重复水印",
        anchor: geometry.anchor,
        widthMm: Math.max(
          2,
          Math.round(rect.width * PX_TO_MM * 10) / 10
        ),
        aspectRatio: Math.max(
          0.05,
          first.naturalWidth > 0 && first.naturalHeight > 0
            ? first.naturalWidth / first.naturalHeight
            : rect.width / rect.height
        ),
        offsetXmm: geometry.offsetXmm,
        offsetYmm: geometry.offsetYmm,
        opacity: Math.min(
          1,
          Math.max(0, Number.parseFloat(style.opacity) || 1)
        )
      });
    }

    const pseudoGroups = new Map<string, Array<{
      selector: string;
      source: string;
      style: CSSStyleDeclaration;
    }>>();
    for (const page of legacyPages()) {
      const owner = pseudoOwnerSelector(page);
      if (!owner) continue;
      for (const pseudo of ["::before", "::after"] as const) {
        const style = getComputedStyle(page, pseudo);
        const source = backgroundImageSource(style.backgroundImage);
        if (!source || style.position !== "absolute" && style.position !== "fixed") {
          continue;
        }
        const selector = `${owner}${pseudo}`;
        const key = `${selector}\n${source}`;
        const group = pseudoGroups.get(key) ?? [];
        group.push({ selector, source, style });
        pseudoGroups.set(key, group);
      }
    }
    for (const group of pseudoGroups.values()) {
      if (group.length < 2) continue;
      const first = group[0]!;
      const width = pixelValue(first.style.width) ?? 0;
      let height = pixelValue(first.style.height) ?? 0;
      const ratioParts = first.style.aspectRatio.split("/").map((part) =>
        Number.parseFloat(part.trim())
      );
      const declaredRatio = ratioParts.length === 2
        && ratioParts.every((part) => Number.isFinite(part) && part > 0)
        ? ratioParts[0]! / ratioParts[1]!
        : 0;
      if (height <= 0 && declaredRatio > 0) height = width / declaredRatio;
      if (width < 12 || height < 4) continue;
      // Computed styles may resolve both sides even when the author declared
      // only top/right. The smaller distance is the real edge anchor.
      const left = pixelValue(first.style.left);
      const right = pixelValue(first.style.right);
      const top = pixelValue(first.style.top);
      const bottom = pixelValue(first.style.bottom);
      const horizontal = right !== null && (left === null || right <= left)
        ? "right"
        : "left";
      const vertical = bottom !== null && (top === null || bottom <= top)
        ? "bottom"
        : "top";
      const anchor = `${vertical}-${horizontal}` as WatermarkAnchor;
      const horizontalOffset = horizontal === "right" ? right : left;
      const verticalOffset = vertical === "bottom" ? bottom : top;
      candidates.push({
        selector: first.selector,
        source: first.source,
        count: group.length,
        name: declaredRatio >= 2 ? "重复 Logo" : "重复水印",
        anchor,
        widthMm: Math.round(width * PX_TO_MM * 10) / 10,
        aspectRatio: Math.max(0.05, declaredRatio || width / height),
        offsetXmm: Math.max(
          0,
          Math.round((horizontalOffset ?? 0) * PX_TO_MM * 10) / 10
        ),
        offsetYmm: Math.max(
          0,
          Math.round((verticalOffset ?? 0) * PX_TO_MM * 10) / 10
        ),
        opacity: Math.min(
          1,
          Math.max(0, Number.parseFloat(first.style.opacity) || 1)
        )
      });
    }
    return candidates.sort((left, right) => right.count - left.count);
  }
}
