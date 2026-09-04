import { z } from "zod";

export const WatermarkAnchorSchema = z.enum([
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right"
]);

export type WatermarkAnchor = z.infer<typeof WatermarkAnchorSchema>;

export const WatermarkItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.string().min(1),
  enabled: z.boolean(),
  anchor: WatermarkAnchorSchema,
  widthMm: z.number().min(2).max(300),
  aspectRatio: z.number().min(0.05).max(50),
  offsetXmm: z.number().min(-300).max(300),
  offsetYmm: z.number().min(-300).max(300),
  opacity: z.number().min(0).max(1),
  rotation: z.number().min(-180).max(180),
  repeat: z.boolean(),
  screen: z.boolean(),
  print: z.boolean(),
  pages: z.array(z.number().int().positive())
});

export type WatermarkItem = z.infer<typeof WatermarkItemSchema>;

export const WatermarkSettingsSchema = z.object({
  version: z.literal(1),
  items: z.array(WatermarkItemSchema),
  suppressedSelectors: z.array(
    z.string().regex(
      /^[.#][A-Za-z_][A-Za-z0-9_-]*(?:::(?:before|after))?$/
    )
  )
});

export type WatermarkSettings = z.infer<typeof WatermarkSettingsSchema>;

export interface LegacyWatermarkCandidate {
  selector: string;
  source: string;
  count: number;
  name: string;
  anchor: WatermarkAnchor;
  widthMm: number;
  aspectRatio: number;
  offsetXmm: number;
  offsetYmm: number;
  opacity: number;
}

const LAYER_ATTRIBUTE = "data-hs-watermark-layer";
const ITEM_ATTRIBUTE = "data-hs-watermark-id";
const MANIFEST_ATTRIBUTE = "data-hs-watermark-manifest";
const STYLE_ATTRIBUTE = "data-hs-watermark-style";

export function createWatermarkSettings(): WatermarkSettings {
  return {
    version: 1,
    items: [],
    suppressedSelectors: []
  };
}

export function parseWatermarkSettings(value: unknown): WatermarkSettings {
  const parsed = WatermarkSettingsSchema.safeParse(value);
  if (!parsed.success) return createWatermarkSettings();
  return {
    ...parsed.data,
    items: parsed.data.items.map((item) => ({
      ...item,
      widthMm: Math.min(300, Math.max(2, item.widthMm)),
      // Edge anchored watermarks must stay inside the page. Negative offsets
      // place every repeated instance in the clipped area; the first page can
      // appear to work only because imported page CSS happens to size it
      // differently.
      offsetXmm: Math.max(0, item.offsetXmm),
      offsetYmm: Math.max(0, item.offsetYmm)
    }))
  };
}

export function readWatermarkSettings(
  document: Document
): WatermarkSettings | null {
  const manifest = document.querySelector<HTMLScriptElement>(
    `script[${MANIFEST_ATTRIBUTE}]`
  );
  if (!manifest?.textContent) return null;
  try {
    return parseWatermarkSettings(JSON.parse(manifest.textContent));
  } catch {
    return null;
  }
}

function pageElements(document: Document): HTMLElement[] {
  const selectors = [
    "[data-page-id]",
    "[data-a4-page]",
    ".a4-editor-page",
    ".print-page",
    ".page",
    ".slide"
  ];
  for (const selector of selectors) {
    const candidates = [
      ...document.querySelectorAll<HTMLElement>(selector)
    ].filter((element) => !element.closest(`[${LAYER_ATTRIBUTE}]`));
    if (candidates.length > 0) {
      return candidates.filter((candidate) =>
        !candidates.some(
          (other) => other !== candidate && other.contains(candidate)
        )
      );
    }
  }
  return document.body ? [document.body] : [];
}

function cssString(value: string): string {
  return JSON.stringify(value).replaceAll("</", "<\\/");
}

function anchorDeclarations(item: WatermarkItem): string {
  const horizontal = item.anchor.endsWith("left")
    ? `left:${item.offsetXmm}mm;`
    : item.anchor.endsWith("right")
      ? `right:${item.offsetXmm}mm;`
      : "left:50%;";
  const vertical = item.anchor.startsWith("top")
    ? `top:${item.offsetYmm}mm;`
    : item.anchor.startsWith("bottom")
      ? `bottom:${item.offsetYmm}mm;`
      : "top:50%;";
  const translateX = item.anchor.endsWith("center")
    || item.anchor === "center" ? "-50%" : "0";
  const translateY = item.anchor.startsWith("middle")
    || item.anchor === "center" ? "-50%" : "0";
  return [
    horizontal,
    vertical,
    `transform:translate(${translateX},${translateY}) rotate(${item.rotation}deg);`
  ].join("");
}

function renderWatermarkCss(settings: WatermarkSettings): string {
  const rules = [
    `[${LAYER_ATTRIBUTE}]{position:absolute!important;inset:0!important;overflow:hidden!important;pointer-events:none!important;user-select:none!important;z-index:2147483000!important;}`,
    `[${LAYER_ATTRIBUTE}]>[${ITEM_ATTRIBUTE}]{position:absolute!important;display:block!important;box-sizing:border-box!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;padding:0!important;margin:0!important;border:0!important;background-color:transparent!important;background-repeat:no-repeat!important;background-position:center!important;background-size:contain!important;pointer-events:auto!important;cursor:grab!important;touch-action:none!important;user-select:none!important;}`,
    `[${LAYER_ATTRIBUTE}]>[${ITEM_ATTRIBUTE}]:hover{outline:2px solid rgba(79,124,255,.88)!important;outline-offset:3px!important;}`,
    `[${LAYER_ATTRIBUTE}]>[${ITEM_ATTRIBUTE}][data-hs-watermark-active]{outline:2px solid #4f7cff!important;outline-offset:3px!important;}`,
    `[data-hs-watermark-resize-handle]{position:absolute!important;bottom:-7px!important;width:14px!important;height:14px!important;min-width:14px!important;min-height:14px!important;padding:0!important;margin:0!important;border:2px solid #fff!important;border-radius:3px!important;background:#4f7cff!important;box-shadow:0 1px 5px rgba(0,0,0,.38)!important;pointer-events:auto!important;z-index:2!important;}`,
    `[data-hs-watermark-resize-handle][data-side=left]{left:-7px!important;right:auto!important;cursor:nesw-resize!important;}`,
    `[data-hs-watermark-resize-handle][data-side=right]{right:-7px!important;left:auto!important;cursor:nwse-resize!important;}`,
    `:is([data-page-id],[data-a4-page],.a4-editor-page,.print-page,.page,.slide):has(>[${LAYER_ATTRIBUTE}]){position:relative!important;isolation:isolate!important;}`
  ];
  for (const item of settings.items) {
    const selector = `[${ITEM_ATTRIBUTE}=${cssString(item.id)}]`;
    const visibility = item.enabled ? "" : "display:none!important;";
    if (item.repeat) {
      rules.push(
        `${selector}{inset:-15%!important;width:auto!important;height:auto!important;`
        + `opacity:${item.opacity}!important;transform:rotate(${item.rotation}deg)!important;`
        + `background-image:url(${cssString(item.source)})!important;`
        + `background-size:${item.widthMm}mm auto!important;background-repeat:repeat!important;`
        + `${visibility}}`
      );
    } else {
      rules.push(
        `${selector}{width:${item.widthMm}mm!important;height:auto!important;`
        + `aspect-ratio:${item.aspectRatio}!important;`
        + `opacity:${item.opacity}!important;`
        + `background-image:url(${cssString(item.source)})!important;`
        + `${anchorDeclarations(item)}${visibility}}`
      );
    }
    if (!item.screen) {
      rules.push(`@media screen{${selector}{display:none!important;}}`);
    }
    if (!item.print) {
      rules.push(`@media print{${selector}{display:none!important;}}`);
    }
  }
  for (const selector of settings.suppressedSelectors) {
    rules.push(`${selector}{display:none!important;}`);
  }
  return rules.join("\n");
}

function appliesToPage(item: WatermarkItem, pageNumber: number): boolean {
  return item.pages.length === 0 || item.pages.includes(pageNumber);
}

export function applyWatermarksToDocument(
  document: Document,
  value: WatermarkSettings
): void {
  const settings = parseWatermarkSettings(value);
  for (const layer of document.querySelectorAll(`[${LAYER_ATTRIBUTE}]`)) {
    layer.remove();
  }
  document.querySelector(`style[${STYLE_ATTRIBUTE}]`)?.remove();
  document.querySelector(`script[${MANIFEST_ATTRIBUTE}]`)?.remove();

  if (
    settings.items.length === 0
    && settings.suppressedSelectors.length === 0
  ) return;

  const style = document.createElement("style");
  style.setAttribute(STYLE_ATTRIBUTE, "");
  style.textContent = renderWatermarkCss(settings);
  (document.head ?? document.documentElement).append(style);

  const manifest = document.createElement("script");
  manifest.type = "application/json";
  manifest.setAttribute(MANIFEST_ATTRIBUTE, "");
  manifest.textContent = JSON.stringify(settings).replaceAll("</", "<\\/");
  (document.head ?? document.documentElement).append(manifest);

  pageElements(document).forEach((page, index) => {
    const pageNumber = index + 1;
    const items = settings.items.filter(
      (item) => appliesToPage(item, pageNumber)
    );
    if (items.length === 0) return;
    const layer = document.createElement("div");
    layer.setAttribute(LAYER_ATTRIBUTE, "");
    layer.setAttribute("aria-hidden", "true");
    for (const item of items) {
      const mark = document.createElement("span");
      mark.setAttribute(ITEM_ATTRIBUTE, item.id);
      mark.setAttribute("aria-hidden", "true");
      layer.append(mark);
    }
    page.append(layer);
  });
}

export function createWatermarkItem(
  source: string,
  aspectRatio: number,
  name = "图片水印"
): WatermarkItem {
  return {
    id: `watermark_${crypto.randomUUID()}`,
    name,
    source,
    enabled: true,
    anchor: "top-right",
    widthMm: 25,
    aspectRatio: Number.isFinite(aspectRatio) && aspectRatio > 0
      ? aspectRatio
      : 3,
    offsetXmm: 9,
    offsetYmm: 8,
    opacity: 0.34,
    rotation: 0,
    repeat: false,
    screen: true,
    print: true,
    pages: []
  };
}
