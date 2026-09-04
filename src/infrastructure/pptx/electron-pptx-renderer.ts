import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { BrowserWindow } from "electron";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import type {
  PptxExportResult
} from "../../domain/pptx/export-options";
import type {
  PptxRenderRequest,
  PptxRenderer
} from "../../application/ports/pptx-renderer";
import { atomicWriteFile } from "../filesystem/atomic-files";
import { stabilizeForPdf } from "../pdf/browser-document-analyzer";
import {
  mergeNativeChartsIntoPptx,
  nativeChartExtractionScript,
  type NativeChartExtraction
} from "./native-chart-export";
import { mergeEditablePptxChunks } from "./editable-pptx-chunks";
import { ensurePowerPointEastAsianFont } from "./pptx-font-normalization";

interface PreparedSlides {
  slides: number;
  usedFallback: boolean;
  documentWidth: number;
  documentHeight: number;
  maxSlideWidth: number;
  maxSlideHeight: number;
}

interface CaptureTarget {
  index: number;
  width: number;
  height: number;
}

interface RiskyVisualTarget extends CaptureTarget {
  marker: string;
}

interface EditableTableMetric {
  rowHeights: number[];
}

interface EditableSlideMetric {
  tables: EditableTableMetric[];
}

const require = createRequire(import.meta.url);
const EMU_PER_INCH = 914400;
const EDITABLE_EXPORT_CHUNK_SIZE = 8;
// Editable exports should use the whole slide. The previous 0.96 "safe area"
// created a visible white frame around every page and made a slide root look
// like an inset card in PowerPoint.
const EDITABLE_SAFE_SCALE = 1;
const ALIBABA_EXTRA_BOLD_FAMILY = "Alibaba PuHuiTi 3.0";

const ENGLISH_GOOGLE_FONT_FAMILIES = [
  "barlow condensed",
  "bebas neue",
  "google sans",
  "ibm plex mono",
  "inter",
  "lato",
  "montserrat",
  "nunito",
  "open sans",
  "oswald",
  "playfair display",
  "poppins",
  "raleway",
  "roboto",
  "roboto mono",
  "source code pro",
  "source sans 3"
];

const POWERPOINT_FONT_ALIASES: Record<string, { latin: string; eastAsian: string }> = {
  "-apple-system": { latin: "Segoe UI", eastAsian: "Microsoft YaHei" },
  "blinkmacsystemfont": { latin: "Segoe UI", eastAsian: "Microsoft YaHei" },
  "system-ui": { latin: "Segoe UI", eastAsian: "Microsoft YaHei" },
  "segoe print": {
    latin: ALIBABA_EXTRA_BOLD_FAMILY,
    eastAsian: ALIBABA_EXTRA_BOLD_FAMILY
  },
  ...Object.fromEntries(ENGLISH_GOOGLE_FONT_FAMILIES.map((family) => [
    family,
    {
      latin: ALIBABA_EXTRA_BOLD_FAMILY,
      eastAsian: ALIBABA_EXTRA_BOLD_FAMILY
    }
  ]))
};

function normalizePowerPointFontAliases(xml: string): string {
  return xml.replace(
    /<a:(latin|ea|cs)\b([^>]*)\btypeface="([^"]*)"([^>]*)\/>/g,
    (tag, script: string, before: string, typeface: string, after: string) => {
      const replacement = POWERPOINT_FONT_ALIASES[typeface.trim().toLowerCase()];
      if (!replacement) return tag;
      const resolved = script === "ea" ? replacement.eastAsian : replacement.latin;
      return `<a:${script}${before}typeface="${resolved}"${after}/>`;
    }
  );
}

function addSingleLineTextSafety(xml: string): string {
  return xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (shape) => {
    const height = Number(
      shape.match(/<a:ext\s+cx="\d+"\s+cy="(\d+)"\s*\/>/)?.[1] ?? 0
    );
    const paragraphCount = (shape.match(/<a:p(?:\s|>)/g) ?? []).length;
    const plainText = Array.from(shape.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g))
      .map((match) => match[1])
      .join("")
      .trim();
    const explicitlySingleLine = /<a:bodyPr\b[^>]*\bwrap="none"/.test(shape);
    const compactCounter = height <= Math.round(EMU_PER_INCH * 0.42)
      && plainText.length > 0
      && plainText.length <= 4;
    const largestFontSize = Math.max(
      0,
      ...Array.from(shape.matchAll(/\bsz="(\d+)"/g))
        .map((match) => Number(match[1]))
    );
    const largeDisplayText = largestFontSize >= 4800
      && plainText.length > 0
      && plainText.length <= 18;
    const isCompactSingleLine = height > 0
      && paragraphCount === 1
      && !shape.includes("<a:br")
      && (
        explicitlySingleLine
        || compactCounter
        || largeDisplayText
      );
    if (!isCompactSingleLine) return shape;

    // Browser auto-width labels (badges, pills and short banners) are measured
    // against Chromium's glyph metrics. PowerPoint can make the same font a
    // few pixels wider, so preserve the one-line intent and reclaim a small
    // part of the CSS padding instead of shrinking the type or widening the
    // surrounding shape into its neighbour.
    return shape.replace(/<a:lnSpc>[\s\S]*?<\/a:lnSpc>/g, "").replace(
      /<a:bodyPr\b[^>]*>/,
      (bodyProperties) => {
        let normalized = bodyProperties
          .replace(/\bwrap="[^"]+"/, 'wrap="none"')
          .replace(
          /\b(lIns|rIns)="(\d+)"/g,
          (_match, name: string, value: string) =>
            `${name}="${Math.max(0, Math.round(Number(value) * 0.7))}"`
          );
        normalized = /\banchor="[^"]+"/.test(normalized)
          ? normalized.replace(/\banchor="[^"]+"/, 'anchor="ctr"')
          : normalized.replace(/>$/, ' anchor="ctr">');
        return normalized;
      }
    );
  });
}

function browserBundlePath(): string {
  const moduleEntry = require.resolve("dom-to-pptx");
  return join(dirname(moduleEntry), "dom-to-pptx.bundle.js");
}

function asBuffer(value: string | ArrayBuffer | Blob | Uint8Array): Buffer {
  if (typeof value === "string") return Buffer.from(value, "binary");
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  throw new Error("Unexpected browser PPTX output type");
}

interface ComplexBackgroundTarget {
  index: number;
  width: number;
  height: number;
}

interface BackgroundCaptureClip extends Electron.Rectangle {
  backgroundColor: string;
}

interface MaterializedPresentationState {
  animatedElements: number;
  formControls: number;
  mappedFontElements: number;
  normalizedPseudoCircles: number;
  suppressedDuplicateTitles: number;
  normalizedNegativeTracking: number;
}

async function materializePresentationState(
  window: BrowserWindow
): Promise<MaterializedPresentationState> {
  return window.webContents.executeJavaScript(`(async function () {
    const roots = Array.from(
      document.querySelectorAll("[data-sierra-pptx-slide]")
    );
    const animatedSelector = [
      ".reveal", ".draw", ".fade", ".fade-in", ".fade-up", ".fade-down",
      ".animate", ".animated", ".build", ".step", ".fragment",
      "[data-aos]", "[data-reveal]", "[data-animate]"
    ].join(",");
    let animatedElements = 0;
    let formControls = 0;
    let mappedFontElements = 0;
    let normalizedPseudoCircles = 0;
    let suppressedDuplicateTitles = 0;
    let normalizedNegativeTracking = 0;
    const replacementFont = ${JSON.stringify(ALIBABA_EXTRA_BOLD_FAMILY)};
    const mappedFontFamilies = new Set(${JSON.stringify([
      "segoe print",
      ...ENGLISH_GOOGLE_FONT_FAMILIES
    ])});
    const pseudoCircleRules = [];

    const copyComputedStyle = (from, to) => {
      const style = getComputedStyle(from);
      for (const property of style) {
        try {
          to.style.setProperty(
            property,
            style.getPropertyValue(property),
            style.getPropertyPriority(property)
          );
        } catch {
          // Ignore browser-owned properties that cannot be assigned inline.
        }
      }
    };

    roots.forEach((root) => {
      root.classList.add("active", "visible", "show", "shown", "is-active");
      root.removeAttribute("hidden");
      root.setAttribute("aria-hidden", "false");
      root.querySelectorAll(animatedSelector).forEach((element) => {
        if (!(element instanceof HTMLElement || element instanceof SVGElement)) {
          return;
        }
        element.style.setProperty("opacity", "1", "important");
        element.style.setProperty("visibility", "visible", "important");
        element.style.setProperty("transform", "none", "important");
        element.style.setProperty("clip-path", "none", "important");
        animatedElements += 1;
      });

      root.querySelectorAll("input, textarea, select").forEach((control) => {
        const rect = control.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return;
        const surrogate = document.createElement("span");
        copyComputedStyle(control, surrogate);
        surrogate.removeAttribute("appearance");
        surrogate.style.setProperty("display", "inline-flex", "important");
        surrogate.style.setProperty("align-items", "center", "important");
        surrogate.style.setProperty("box-sizing", "border-box", "important");
        surrogate.style.setProperty("width", rect.width + "px", "important");
        surrogate.style.setProperty("height", rect.height + "px", "important");
        surrogate.style.setProperty("opacity", "1", "important");
        surrogate.style.setProperty("visibility", "visible", "important");
        if (control instanceof HTMLInputElement) {
          if (control.type === "checkbox" || control.type === "radio") {
            surrogate.textContent = control.checked ? "✓" : "";
            surrogate.style.setProperty("justify-content", "center", "important");
            surrogate.style.setProperty("border", "1px solid currentColor", "important");
          } else {
            surrogate.textContent = control.value || control.placeholder || "";
          }
        } else if (control instanceof HTMLSelectElement) {
          surrogate.textContent = control.selectedOptions[0]?.textContent || "";
        } else {
          surrogate.textContent = control.value || control.placeholder || "";
        }
        control.replaceWith(surrogate);
        formControls += 1;
      });

      [root, ...Array.from(root.querySelectorAll("*"))].forEach((element) => {
        if (!(element instanceof HTMLElement || element instanceof SVGElement)) {
          return;
        }
        const style = getComputedStyle(element);
        const letterSpacing = Number.parseFloat(style.letterSpacing || "0");
        if (Number.isFinite(letterSpacing) && letterSpacing < 0) {
          element.style.setProperty("letter-spacing", "0", "important");
          normalizedNegativeTracking += 1;
        }
        const primaryFont = String(style.fontFamily || "")
          .split(",")[0]
          .trim()
          .replace(/^['\"]|['\"]$/g, "")
          .toLowerCase();
        if (mappedFontFamilies.has(primaryFont)) {
          element.style.setProperty(
            "font-family",
            '"' + replacementFont + '", "Microsoft YaHei", sans-serif',
            "important"
          );
          // PowerPoint reads the ExtraBold TTF's advance widths incorrectly
          // on some Office builds. Use Alibaba's stable regular face and let
          // Office apply the requested ExtraBold appearance.
          element.style.setProperty("font-weight", "800", "important");
          element.style.setProperty("letter-spacing", "0", "important");
          mappedFontElements += 1;
        }

        ["before", "after"].forEach((pseudoType) => {
          const pseudoStyle = getComputedStyle(element, "::" + pseudoType);
          if (
            pseudoStyle.display === "none"
            || !String(pseudoStyle.borderRadius || "").includes("%")
          ) {
            return;
          }
          const marker = "sierra-pptx-circle-" + normalizedPseudoCircles;
          const markerAttribute = "data-sierra-pptx-pseudo-" + pseudoType;
          element.setAttribute(markerAttribute, marker);
          pseudoCircleRules.push(
            '[' + markerAttribute + '="' + marker + '"]::'
            + pseudoType + ' { border-radius: 9999px !important; }'
          );
          normalizedPseudoCircles += 1;
        });
      });

      const rootRect = root.getBoundingClientRect();
      const titleGroups = new Map();
      Array.from(root.querySelectorAll("*")).forEach((element) => {
        if (!(element instanceof HTMLElement || element instanceof SVGElement)) {
          return;
        }
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (
          style.display === "none"
          || style.visibility === "hidden"
          || rect.width < 1
          || rect.height < 1
          || rect.top < rootRect.top - 1
          || rect.top > rootRect.top + rootRect.height * 0.18
        ) {
          return;
        }
        const hasLayoutChild = Array.from(element.children).some((child) => {
          const display = getComputedStyle(child).display;
          return !["inline", "inline-block", "contents"].includes(display);
        });
        if (hasLayoutChild) return;
        const key = String(element.textContent || "")
          .replace(/[\\s\\u00a0]+/g, "")
          .toLowerCase();
        if (key.length < 5) return;
        const group = titleGroups.get(key) || [];
        group.push({ element, top: rect.top });
        titleGroups.set(key, group);
      });
      titleGroups.forEach((group) => {
        if (group.length < 2) return;
        group.sort((left, right) => left.top - right.top);
        const keep = group[0].element;
        group.slice(1).forEach(({ element }) => {
          if (keep.contains(element) || element.contains(keep)) return;
          // Preserve the HTML layout position, but exclude the repeated title
          // source before dom-to-pptx creates any PowerPoint text object.
          element.style.setProperty("visibility", "hidden", "important");
          suppressedDuplicateTitles += 1;
        });
      });
    });

    if (pseudoCircleRules.length > 0) {
      const style = document.createElement("style");
      style.setAttribute("data-sierra-pptx-geometry-fixes", "true");
      style.textContent = pseudoCircleRules.join("\\n");
      document.head.appendChild(style);
    }

    try {
      await document.fonts.load('800 16px "' + replacementFont + '"');
      await document.fonts.ready;
    } catch {
      // The OOXML alias pass below still guarantees the requested font name.
    }

    // The requested Alibaba face is wider than several condensed Google
    // display fonts. Keep short display metrics inside their original grid
    // cell by reducing only the overflowing element's font size.
    roots.forEach((root) => {
      root.querySelectorAll(".metric-row").forEach((row) => {
        if (!(row instanceof HTMLElement)) return;
        const cells = Array.from(row.children).filter(
          (child) => child instanceof HTMLElement
        );
        if (cells.length === 0) return;
        row.style.setProperty(
          "grid-template-columns",
          "repeat(" + cells.length + ", minmax(0, 1fr))",
          "important"
        );
        cells.forEach((cell) => cell.style.setProperty("min-width", "0", "important"));
      });
      const measureCanvas = document.createElement("canvas");
      const measureContext = measureCanvas.getContext("2d");
      [root, ...Array.from(root.querySelectorAll("*"))].forEach((element) => {
        if (!(element instanceof HTMLElement)) return;
        const text = String(element.textContent || "").trim();
        if (!text || text.length > 18 || element.children.length > 0) return;
        const style = getComputedStyle(element);
        const fontSize = Number.parseFloat(style.fontSize || "0");
        if (!Number.isFinite(fontSize) || fontSize < 48) return;
        element.style.setProperty("white-space", "nowrap", "important");
        const availableWidth = element.clientWidth;
        if (measureContext) {
          measureContext.font = style.font;
        }
        const measuredTextWidth = measureContext
          ? measureContext.measureText(text).width
          : 0;
        const requiredWidth = Math.max(element.scrollWidth, measuredTextWidth);
        if (availableWidth <= 0 || requiredWidth <= availableWidth + 1) return;
        const scale = Math.max(0.58, (availableWidth / requiredWidth) * 0.96);
        element.style.setProperty(
          "font-size",
          Math.max(24, fontSize * scale) + "px",
          "important"
        );
      });
    });

    document.getAnimations?.().forEach((animation) => {
      try {
        animation.finish();
      } catch {
        animation.cancel();
      }
    });
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
    return {
      animatedElements,
      formControls,
      mappedFontElements,
      normalizedPseudoCircles,
      suppressedDuplicateTitles,
      normalizedNegativeTracking
    };
  })()`, true) as Promise<MaterializedPresentationState>;
}

/**
 * dom-to-pptx currently treats every `linear-gradient(...)` found in a CSS
 * background as one gradient. A comma-separated, layered background therefore
 * gets parsed as invalid color stops and can turn into a large black diagonal
 * band. Flatten only the slide canvas background to PNG first; text, cards,
 * charts and all other foreground objects remain editable.
 */
async function flattenComplexSlideBackgrounds(
  window: BrowserWindow
): Promise<number> {
  const targets = await window.webContents.executeJavaScript(`(function () {
    return Array.from(
      document.querySelectorAll("[data-sierra-pptx-slide]")
    ).map((element, index) => {
      const rect = element.getBoundingClientRect();
      const styles = [
        getComputedStyle(element),
        getComputedStyle(element, "::before"),
        getComputedStyle(element, "::after")
      ];
      const gradientCounts = styles.map((style) =>
        (style.backgroundImage || "").toLowerCase()
          .split("gradient(").length - 1
      );
      return {
        index,
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
        complex: gradientCounts.some((count) => count > 1)
      };
    }).filter((target) =>
      target.complex && target.width > 0 && target.height > 0
    );
  })()`, true) as Array<ComplexBackgroundTarget & { complex: boolean }>;

  let flattened = 0;
  const [originalWidth = 1, originalHeight = 1] = window.getContentSize();
  if (targets.length > 0) {
    window.setContentSize(
      Math.max(originalWidth, ...targets.map((target) => target.width)),
      Math.max(originalHeight, ...targets.map((target) => target.height))
    );
    await window.webContents.executeJavaScript(`new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    )`, true);
  }
  try {
    for (const target of targets) {
    const clip = await window.webContents.executeJavaScript(`(async function () {
      const root = document.querySelector(
        '[data-sierra-pptx-slide="${target.index}"]'
      );
      if (!root) return null;

      const parseColor = (value) => {
        const match = String(value).match(
          /rgba?\\(\\s*([\\d.]+)[, ]+([\\d.]+)[, ]+([\\d.]+)(?:\\s*[,/]\\s*([\\d.]+))?\\s*\\)/i
        );
        return match ? {
          red: Number(match[1]),
          green: Number(match[2]),
          blue: Number(match[3]),
          alpha: match[4] === undefined ? 1 : Number(match[4])
        } : null;
      };
      const compositeBackdrop = (element) => {
        const layers = [];
        let current = element;
        while (current) {
          const color = parseColor(getComputedStyle(current).backgroundColor);
          if (color && color.alpha > 0) layers.push(color);
          if (color?.alpha >= 0.999) break;
          current = current.parentElement;
        }
        let result = { red: 255, green: 255, blue: 255 };
        for (let index = layers.length - 1; index >= 0; index -= 1) {
          const layer = layers[index];
          result = {
            red: layer.red * layer.alpha + result.red * (1 - layer.alpha),
            green: layer.green * layer.alpha + result.green * (1 - layer.alpha),
            blue: layer.blue * layer.alpha + result.blue * (1 - layer.alpha)
          };
        }
        return "rgb(" + Math.round(result.red) + ", "
          + Math.round(result.green) + ", "
          + Math.round(result.blue) + ")";
      };
      // Chromium can keep transparent gradient stops as semi-transparent
      // black pixels in capturePage(). They look correct in-browser because
      // the page backdrop is composited first, but PowerPoint exposes the dark
      // RGB channels. Make that backdrop explicit before taking the PNG.
      const backgroundColor = compositeBackdrop(root);
      root.style.setProperty("background-color", backgroundColor, "important");

      Array.from(
        document.querySelectorAll("[data-sierra-pptx-slide]")
      ).forEach((slide) => {
        slide.setAttribute(
          "data-sierra-pptx-capture-visibility",
          JSON.stringify({
            value: slide.style.getPropertyValue("visibility"),
            priority: slide.style.getPropertyPriority("visibility")
          })
        );
        slide.style.setProperty(
          "visibility",
          slide === root ? "visible" : "hidden",
          "important"
        );
      });

      const captureLayoutProperties = [
        "position", "inset", "top", "right", "bottom", "left",
        "width", "height", "min-width", "min-height", "max-width",
        "max-height", "margin", "transform", "z-index"
      ];
      root.setAttribute(
        "data-sierra-pptx-capture-layout",
        JSON.stringify(Object.fromEntries(captureLayoutProperties.map((property) => [
          property,
          {
            value: root.style.getPropertyValue(property),
            priority: root.style.getPropertyPriority(property)
          }
        ])))
      );
      root.style.setProperty("position", "fixed", "important");
      root.style.setProperty("inset", "auto", "important");
      root.style.setProperty("top", "0", "important");
      root.style.setProperty("left", "0", "important");
      root.style.setProperty("right", "auto", "important");
      root.style.setProperty("bottom", "auto", "important");
      root.style.setProperty("width", ${JSON.stringify(`${target.width}px`)}, "important");
      root.style.setProperty("height", ${JSON.stringify(`${target.height}px`)}, "important");
      root.style.setProperty("min-width", "0", "important");
      root.style.setProperty("min-height", "0", "important");
      root.style.setProperty("max-width", "none", "important");
      root.style.setProperty("max-height", "none", "important");
      root.style.setProperty("margin", "0", "important");
      root.style.setProperty("transform", "none", "important");
      root.style.setProperty("z-index", "2147483647", "important");

      // Background capture must contain the slide canvas only. Animation
      // materialization writes inline visibility:visible !important to
      // reveal/draw nodes; a stylesheet cannot reliably override those
      // declarations. Hide every foreground descendant inline and restore it
      // after capture so editable text is never baked into the background PNG.
      Array.from(root.querySelectorAll("*")).forEach((descendant) => {
        if (!(descendant instanceof HTMLElement || descendant instanceof SVGElement)) {
          return;
        }
        descendant.setAttribute(
          "data-sierra-pptx-capture-foreground-visibility",
          JSON.stringify({
            value: descendant.style.getPropertyValue("visibility"),
            priority: descendant.style.getPropertyPriority("visibility")
          })
        );
        descendant.style.setProperty("visibility", "hidden", "important");
      });

      const style = document.createElement("style");
      style.id = "sierra-pptx-background-capture";
      style.textContent = [
        'html, body { scrollbar-width: none !important; }',
        'html::-webkit-scrollbar, body::-webkit-scrollbar, *::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }',
        'body * { visibility: hidden !important; }',
        '[data-sierra-pptx-background-capture] { visibility: visible !important; }',
        '[data-sierra-pptx-background-capture] > * { visibility: hidden !important; }',
      ].join("\\n");
      document.head.appendChild(style);
      root.setAttribute("data-sierra-pptx-background-capture", "");
      window.scrollTo({ left: 0, top: 0, behavior: "instant" });
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
      const rect = root.getBoundingClientRect();
      const width = Math.max(1, Math.min(
        window.innerWidth,
        Math.ceil(rect.width)
      ));
      const height = Math.max(1, Math.min(
        window.innerHeight,
        Math.ceil(rect.height)
      ));
      return { x: 0, y: 0, width, height, backgroundColor };
    })()`, true) as BackgroundCaptureClip | null;

      if (!clip) continue;
      try {
        const complete = clip.width >= target.width - 1
          && clip.height >= target.height - 1;
        if (!complete) continue;
      // The export window is hidden. Force Chromium to submit a fresh frame
      // after switching the isolated slide, otherwise capturePage() can reuse
      // an older compositor surface on later pages.
      window.webContents.invalidate();
      await new Promise((resolve) => setTimeout(resolve, 60));
      const image = await window.webContents.capturePage({
        x: clip.x,
        y: clip.y,
        width: clip.width,
        height: clip.height
      });
      const capturedDataUrl = `data:image/png;base64,${image.toPNG().toString("base64")}`;
      const dataUrl = await window.webContents.executeJavaScript(`(async function () {
        const image = new Image();
        image.src = ${JSON.stringify(capturedDataUrl)};
        if (image.decode) await image.decode();
        else await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
        });
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas unavailable during PPTX export");
        context.fillStyle = ${JSON.stringify(clip.backgroundColor)};
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        return canvas.toDataURL("image/png");
      })()`, true) as string;
      await window.webContents.executeJavaScript(`(function () {
        const root = document.querySelector(
          '[data-sierra-pptx-slide="${target.index}"]'
        );
        if (!root) return;
        root.style.setProperty(
          "background-image",
          ${JSON.stringify(`url("${dataUrl}")`)},
          "important"
        );
        root.style.setProperty("background-size", "100% 100%", "important");
        root.style.setProperty("background-position", "0 0", "important");
        root.style.setProperty("background-repeat", "no-repeat", "important");
        root.setAttribute("data-sierra-pptx-flattened-background", "");
        let pseudoStyle = document.getElementById(
          "sierra-pptx-flattened-background-pseudos"
        );
        if (!pseudoStyle) {
          pseudoStyle = document.createElement("style");
          pseudoStyle.id = "sierra-pptx-flattened-background-pseudos";
          pseudoStyle.textContent = [
            '[data-sierra-pptx-flattened-background]::before,',
            '[data-sierra-pptx-flattened-background]::after { content: none !important; display: none !important; }'
          ].join("\\n");
          document.head.appendChild(pseudoStyle);
        }
      })()`, true);
        flattened += 1;
      } finally {
        await window.webContents.executeJavaScript(`(function () {
          document.getElementById("sierra-pptx-background-capture")?.remove();
          document.querySelector(
            '[data-sierra-pptx-slide="${target.index}"]'
          )?.removeAttribute("data-sierra-pptx-background-capture");
          const capturedRoot = document.querySelector(
            '[data-sierra-pptx-slide="${target.index}"]'
          );
          if (capturedRoot?.hasAttribute("data-sierra-pptx-capture-layout")) {
            try {
              const originalLayout = JSON.parse(capturedRoot.getAttribute(
                "data-sierra-pptx-capture-layout"
              ) || "{}");
              Object.entries(originalLayout).forEach(([property, original]) => {
                if (original?.value) {
                  capturedRoot.style.setProperty(
                    property,
                    original.value,
                    original.priority || ""
                  );
                } else {
                  capturedRoot.style.removeProperty(property);
                }
              });
            } finally {
              capturedRoot.removeAttribute("data-sierra-pptx-capture-layout");
            }
          }
          document.querySelectorAll(
            "[data-sierra-pptx-capture-visibility]"
          ).forEach((slide) => {
            try {
              const original = JSON.parse(slide.getAttribute(
                "data-sierra-pptx-capture-visibility"
              ) || "{}");
              if (original.value) {
                slide.style.setProperty(
                  "visibility",
                  original.value,
                  original.priority || ""
                );
              } else {
                slide.style.removeProperty("visibility");
              }
            } finally {
              slide.removeAttribute("data-sierra-pptx-capture-visibility");
            }
          });
          document.querySelectorAll(
            "[data-sierra-pptx-capture-foreground-visibility]"
          ).forEach((element) => {
            try {
              const original = JSON.parse(element.getAttribute(
                "data-sierra-pptx-capture-foreground-visibility"
              ) || "{}");
              if (original.value) {
                element.style.setProperty(
                  "visibility",
                  original.value,
                  original.priority || ""
                );
              } else {
                element.style.removeProperty("visibility");
              }
            } finally {
              element.removeAttribute(
                "data-sierra-pptx-capture-foreground-visibility"
              );
            }
          });
        })()`, true);
      }
    }
  } finally {
    window.setContentSize(originalWidth, originalHeight);
    await window.webContents.executeJavaScript(`new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    )`, true);
  }

  return flattened;
}

/**
 * PowerPoint cannot faithfully represent several browser-only visual systems
 * (conic/repeating gradients, masks, clipping paths and CSS-variable-sized
 * charts). In hybrid mode, replace only those bounded regions with a browser
 * snapshot. Surrounding headings, copy, tables and simple shapes stay editable.
 */
async function rasterizeRiskyVisualRegions(
  window: BrowserWindow,
  conicOnly = false
): Promise<number> {
  const targets = await window.webContents.executeJavaScript(`(function () {
    const conicOnly = ${JSON.stringify(conicOnly)};
    const roots = Array.from(
      document.querySelectorAll("[data-sierra-pptx-slide]")
    );
    const candidates = [];
    const addCandidate = (element) => {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) return;
      const root = element.closest("[data-sierra-pptx-slide]");
      if (!root || element === root) return;
      const rect = element.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      if (
        rect.width < 8
        || rect.height < 8
        || rect.width * rect.height > rootRect.width * rootRect.height * 0.88
      ) return;
      candidates.push(element);
    };

    roots.forEach((root) => {
      root.querySelectorAll("*").forEach((element) => {
        if (!(element instanceof HTMLElement || element instanceof SVGElement)) return;
        const style = getComputedStyle(element);
        const background = String(style.backgroundImage || "").toLowerCase();
        const gradientCount = background.split("gradient(").length - 1;
        const riskyBackground = background.includes("conic-gradient(")
          || (!conicOnly && (
            background.includes("repeating-linear-gradient(")
            || background.includes("repeating-radial-gradient(")
            || gradientCount > 1
          ));
        const riskyGeometry = !conicOnly && (
          style.clipPath !== "none" || style.maskImage !== "none"
        );
        const explicitlyRasterized = !conicOnly
          && element.hasAttribute("data-pptx-raster");
        if (riskyBackground || riskyGeometry || explicitlyRasterized) {
          addCandidate(element);
        }

        const inlineStyle = element.getAttribute("style") || "";
        if (!conicOnly && /--(?:h|w|x|y|size)\\s*:/i.test(inlineStyle)) {
          addCandidate(element.closest([
            "[data-pptx-raster]",
            ".html-chart",
            ".chart-container",
            ".chart-panel",
            "figure"
          ].join(",")) || element);
        }
      });
    });

    const unique = Array.from(new Set(candidates)).filter((element) =>
      !candidates.some((other) => other !== element && other.contains(element))
    );
    return unique.map((element, index) => {
      const marker = "sierra-risky-visual-" + index;
      element.setAttribute("data-sierra-pptx-risky-visual", marker);
      const rect = element.getBoundingClientRect();
      return {
        marker,
        index,
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height)
      };
    });
  })()`, true) as RiskyVisualTarget[];

  let rasterized = 0;
  for (const target of targets) {
    const clip = await window.webContents.executeJavaScript(`(async function () {
      const element = document.querySelector(
        '[data-sierra-pptx-risky-visual="${target.marker}"]'
      );
      if (!element) return null;
      element.scrollIntoView({ block: "center", inline: "center" });
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
      const rect = element.getBoundingClientRect();
      const x = Math.max(0, Math.floor(rect.left));
      const y = Math.max(0, Math.floor(rect.top));
      return {
        x,
        y,
        width: Math.max(1, Math.min(window.innerWidth - x, Math.ceil(rect.width))),
        height: Math.max(1, Math.min(window.innerHeight - y, Math.ceil(rect.height)))
      };
    })()`, true) as Electron.Rectangle | null;
    if (
      !clip
      || clip.width < target.width - 2
      || clip.height < target.height - 2
    ) continue;

    window.webContents.invalidate();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const capture = await window.webContents.capturePage(clip);
    const dataUrl = `data:image/png;base64,${capture.toPNG().toString("base64")}`;
    const replaced = await window.webContents.executeJavaScript(`(async function () {
      const element = document.querySelector(
        '[data-sierra-pptx-risky-visual="${target.marker}"]'
      );
      if (!element || !element.parentElement) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const image = document.createElement("img");
      image.src = ${JSON.stringify(dataUrl)};
      image.alt = element.getAttribute("aria-label")
        || element.getAttribute("title")
        || "复杂视觉区域";
      image.setAttribute("data-sierra-pptx-rasterized-region", "");
      image.style.cssText = [
        "box-sizing:border-box",
        "border:0",
        "padding:0",
        "object-fit:fill",
        "width:" + rect.width + "px",
        "height:" + rect.height + "px",
        "min-width:" + rect.width + "px",
        "min-height:" + rect.height + "px",
        "max-width:none",
        "max-height:none",
        "display:" + (style.display === "inline" ? "inline-block" : style.display),
        "position:" + style.position,
        "top:" + style.top,
        "right:" + style.right,
        "bottom:" + style.bottom,
        "left:" + style.left,
        "margin:" + style.margin,
        "transform:" + style.transform,
        "transform-origin:" + style.transformOrigin,
        "grid-area:" + style.gridArea,
        "grid-column:" + style.gridColumn,
        "grid-row:" + style.gridRow,
        "align-self:" + style.alignSelf,
        "justify-self:" + style.justifySelf,
        "z-index:" + style.zIndex
      ].join(";");
      element.replaceWith(image);
      if (image.decode) await image.decode();
      else await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
      });
      return true;
    })()`, true) as boolean;
    if (replaced) rasterized += 1;
  }

  await window.webContents.executeJavaScript(`new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  )`, true);
  return rasterized;
}

async function materializeCssCounters(window: BrowserWindow): Promise<number> {
  return window.webContents.executeJavaScript(`(function () {
    document.getElementById("sierra-pptx-materialized-counters")?.remove();
    const style = document.createElement("style");
    style.id = "sierra-pptx-materialized-counters";
    style.textContent = [
      '[data-sierra-pptx-counter-before]::before { content: attr(data-sierra-pptx-counter-before) !important; }',
      '[data-sierra-pptx-counter-after]::after { content: attr(data-sierra-pptx-counter-after) !important; }'
    ].join("\\n");
    document.head.appendChild(style);

    const states = new Map();
    let materialized = 0;
    document.querySelectorAll("[data-sierra-pptx-slide]").forEach((root) => {
      [root, ...Array.from(root.querySelectorAll("*"))].forEach((element) => {
        ["before", "after"].forEach((side) => {
          const pseudo = "::" + side;
          const pseudoStyle = getComputedStyle(element, pseudo);
          const counterName = pseudoStyle.content?.match(
            /counter\\(\\s*([\\w-]+)/i
          )?.[1];
          if (!counterName) return;
          const parent = element.parentElement || root;
          const key = side + "::" + counterName;
          let parentStates = states.get(parent);
          if (!parentStates) {
            parentStates = new Map();
            states.set(parent, parentStates);
          }
          let current = parentStates.get(key);
          if (current === undefined) {
            const reset = getComputedStyle(parent).counterReset || "";
            const resetMatch = reset.match(
              new RegExp("(?:^|\\\\s)" + counterName + "(?:\\\\s+(-?\\\\d+))?")
            );
            current = Number(resetMatch?.[1] || 0);
          }
          const increment = pseudoStyle.counterIncrement || "";
          const incrementMatch = increment.match(
            new RegExp("(?:^|\\\\s)" + counterName + "(?:\\\\s+(-?\\\\d+))?")
          );
          current += Number(incrementMatch?.[1] || 1);
          parentStates.set(key, current);
          element.setAttribute(
            "data-sierra-pptx-counter-" + side,
            String(current)
          );
          materialized += 1;
        });
      });
    });
    return materialized;
  })()`, true) as Promise<number>;
}

function scaleTopLevelObjects(xml: string, slideWidth: number, slideHeight: number): string {
  const marginX = Math.round(slideWidth * (1 - EDITABLE_SAFE_SCALE) / 2);
  const marginY = Math.round(slideHeight * (1 - EDITABLE_SAFE_SCALE) / 2);
  return xml.replace(
    /<p:(sp|pic|graphicFrame)\b[\s\S]*?<\/p:\1>/g,
    (block) => {
      let transformed = block.replace(
        /<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"\s*\/>\s*<a:ext\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/,
        (_match, xValue: string, yValue: string, widthValue: string, heightValue: string) => {
          const x = marginX + Math.round(Number(xValue) * EDITABLE_SAFE_SCALE);
          const y = marginY + Math.round(Number(yValue) * EDITABLE_SAFE_SCALE);
          const width = Math.round(Number(widthValue) * EDITABLE_SAFE_SCALE);
          const height = Math.round(Number(heightValue) * EDITABLE_SAFE_SCALE);
          return `<a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/>`;
        }
      );
      transformed = transformed.replace(
        /\bsz="(\d+)"/g,
        (_match, sizeValue: string) =>
          `sz="${Math.max(100, Math.round(Number(sizeValue) * EDITABLE_SAFE_SCALE))}"`
      );
      return transformed;
    }
  );
}

function expandRootBackground(xml: string, slideWidth: number, slideHeight: number): string {
  let expanded = false;
  return xml.replace(
    /<p:(sp|pic)\b[\s\S]*?<\/p:\1>/g,
    (block) => {
      if (expanded || block.includes("<p:txBody>")) return block;
      const transform = block.match(
        /<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"\s*\/>\s*<a:ext\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/
      );
      if (!transform) return block;
      const x = Number(transform[1]);
      const y = Number(transform[2]);
      const width = Number(transform[3]);
      const height = Number(transform[4]);
      const coversCanvas = x >= 0
        && y >= 0
        && x <= slideWidth * 0.06
        && y <= slideHeight * 0.06
        && width >= slideWidth * 0.88
        && height >= slideHeight * 0.88;
      if (!coversCanvas) return block;
      expanded = true;
      return block.replace(
        transform[0],
        `<a:off x="0" y="0"/><a:ext cx="${slideWidth}" cy="${slideHeight}"/>`
      );
    }
  );
}

async function normalizeEditablePptx(
  input: Buffer,
  metrics: EditableSlideMetric[]
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(input);
  const presentationFile = zip.file("ppt/presentation.xml");
  const presentationXml = presentationFile
    ? await presentationFile.async("string")
    : "";
  const slideSize = presentationXml.match(
    /<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/
  );
  const slideWidth = Number(slideSize?.[1] ?? 0);
  const slideHeight = Number(slideSize?.[2] ?? 0);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => {
      const leftIndex = Number(left.match(/slide(\d+)/)?.[1] ?? 0);
      const rightIndex = Number(right.match(/slide(\d+)/)?.[1] ?? 0);
      return leftIndex - rightIndex;
    });
  const labels: Record<string, string> = {
    text: "文本",
    image: "图片",
    shape: "形状",
    table: "表格"
  };

  for (const [slideIndex, fileName] of slideFiles.entries()) {
    const file = zip.file(fileName);
    if (!file) continue;
    let xml = await file.async("string");
    const slideMetric = metrics[slideIndex];
    let tableIndex = 0;
    xml = xml.replace(
      /<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g,
      (frame) => {
        if (!frame.includes("<a:tbl>")) return frame;
        const tableMetric = slideMetric?.tables[tableIndex];
        tableIndex += 1;
        if (!tableMetric || tableMetric.rowHeights.length === 0) return frame;
        let rowIndex = 0;
        const denseTable = tableMetric.rowHeights.length >= 10;
        const denseRowScale = denseTable ? 0.78 : 1;
        const fittedRowHeights = tableMetric.rowHeights.map((height) =>
          Math.max(
            1,
            Math.round(
              height * EDITABLE_SAFE_SCALE * denseRowScale
            )
          )
        );
        let updated = frame.replace(
          /<a:tr\b([^>]*)\bh="\d+"([^>]*)>/g,
          (tag, before: string, after: string) => {
            const height = fittedRowHeights[rowIndex];
            rowIndex += 1;
            return height
              ? `<a:tr${before}h="${height}"${after}>`
              : tag;
          }
        );
        const totalHeight = fittedRowHeights.reduce(
          (sum, height) => sum + height,
          0
        );
        const frameHeightBeforeSafeScale = Math.round(
          totalHeight / EDITABLE_SAFE_SCALE
        );
        updated = updated.replace(
          /(<p:xfrm>\s*<a:off\b[^>]*\/>\s*<a:ext\b[^>]*\bcy=")\d+(")/,
          `$1${frameHeightBeforeSafeScale}$2`
        );
        updated = updated.replace(
          /<a:bodyPr\s*\/>/g,
          '<a:bodyPr wrap="square"><a:normAutofit fontScale="90000" lnSpcReduction="16000"/></a:bodyPr>'
        );
        if (denseTable) {
          updated = updated.replace(
            /\bsz="(\d+)"/g,
            (_match, value: string) =>
              `sz="${Math.max(100, Math.round(Number(value) * 0.86))}"`
          );
          updated = updated.replace(
            /(<a:spcPts\s+val=")(\d+)("\s*\/>)/g,
            (_match, before: string, value: string, after: string) =>
              `${before}${Math.max(100, Math.round(Number(value) * 0.72))}${after}`
          );
        }
        const marginScale = denseTable ? 0.38 : 0.62;
        updated = updated.replace(
          /\b(marL|marR|marT|marB)="(\d+)"/g,
          (_match, name: string, value: string) =>
            `${name}="${Math.max(0, Math.round(Number(value) * marginScale))}"`
        );
        return updated;
      }
    );
    if (slideWidth > 0 && slideHeight > 0) {
      xml = scaleTopLevelObjects(xml, slideWidth, slideHeight);
      xml = expandRootBackground(xml, slideWidth, slideHeight);
    }
    xml = normalizePowerPointFontAliases(xml);
    xml = ensurePowerPointEastAsianFont(xml);
    xml = addSingleLineTextSafety(xml);
    const counters = new Map<string, number>();
    xml = xml.replace(
      /<p:cNvPr\b[^>]*\bname="([^"]*)"[^>]*>/g,
      (tag, currentName: string) => {
        const embeddedType = currentName.match(/__type_([a-z]+)/)?.[1];
        const type = embeddedType
          ?? (/^TextBox\b/i.test(currentName)
            ? "text"
            : /^Picture\b/i.test(currentName)
              ? "image"
              : /^Shape\b/i.test(currentName)
                ? "shape"
                : /^(Table|Object)\b/i.test(currentName)
                  ? "table"
                  : null);
        if (!type) return tag;
        const next = (counters.get(type) ?? 0) + 1;
        counters.set(type, next);
        const label = labels[type] ?? "图层";
        return tag.replace(
          /\bname="[^"]*"/,
          `name="${label} ${String(next).padStart(2, "0")}"`
        );
      }
    );
    zip.file(fileName, xml);
  }

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
}

export class ElectronPptxRenderer implements PptxRenderer {
  async render(request: PptxRenderRequest): Promise<PptxExportResult> {
    const { options } = request;
    const window = new BrowserWindow({
      show: false,
      width: options.viewportWidth,
      height: options.viewportHeight,
      useContentSize: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    });

    const warnings: string[] = [];
    try {
      await window.loadURL(request.documentUrl);
      await stabilizeForPdf(window.webContents);
      const prepared = await this.prepareSlides(window);
      if (prepared.usedFallback) {
        warnings.push(
          "未检测到明确的幻灯片容器，已根据页面结构自动拆分。"
        );
      }
      const [currentWidth = 1, currentHeight = 1] = window.getContentSize();
      const exportWidth = Math.max(
        currentWidth,
        Math.min(7680, Math.ceil(prepared.maxSlideWidth))
      );
      const exportHeight = Math.max(
        currentHeight,
        Math.min(4320, Math.ceil(prepared.maxSlideHeight))
      );
      if (exportWidth !== currentWidth || exportHeight !== currentHeight) {
        window.setContentSize(exportWidth, exportHeight);
        await window.webContents.executeJavaScript(`new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )`, true);
      }
      const materialized = await materializePresentationState(window);
      if (materialized.animatedElements > 0) {
        warnings.push(
          `${materialized.animatedElements} 个入场动画对象已固定为最终可见状态。`
        );
      }
      if (materialized.formControls > 0) {
        warnings.push(
          `${materialized.formControls} 个表单控件已转换为可编辑的静态文本/符号。`
        );
      }
      if (materialized.mappedFontElements > 0) {
        warnings.push(
          `${materialized.mappedFontElements} 个 Segoe Print / Google 英文字体对象已映射为阿里巴巴普惠体 ExtraBold。`
        );
      }
      if (materialized.normalizedPseudoCircles > 0) {
        warnings.push(
          `${materialized.normalizedPseudoCircles} 个百分比圆形装饰已按圆形几何导出。`
        );
      }
      if (materialized.suppressedDuplicateTitles > 0) {
        warnings.push(
          `${materialized.suppressedDuplicateTitles} 个重复页眉标题源已在生成文字框前抑制。`
        );
      }
      if (materialized.normalizedNegativeTracking > 0) {
        warnings.push(
          `${materialized.normalizedNegativeTracking} 个负字距文本已按 PowerPoint 字体度量归零，避免字符重叠。`
        );
      }

      const output = options.mode !== "fidelity"
        ? await this.renderEditable(
          window,
          options.slideWidth,
          options.slideHeight,
          prepared.slides,
          warnings,
          options.mode === "hybrid"
        )
        : await this.renderFidelity(
          window,
          options.slideWidth,
          options.slideHeight,
          exportHeight
        );
      await atomicWriteFile(request.outputPath, output);

      return {
        outputPath: request.outputPath,
        mode: options.mode,
        slides: prepared.slides,
        warnings
      };
    } finally {
      if (!window.isDestroyed()) window.destroy();
    }
  }

  private async prepareSlides(window: BrowserWindow): Promise<PreparedSlides> {
    return window.webContents.executeJavaScript(`(async function () {
      document.querySelectorAll("[data-sierra-pptx-slide]").forEach((element) => {
        element.removeAttribute("data-sierra-pptx-slide");
      });

      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity || 1) > 0
          && rect.width >= 120
          && rect.height >= 80;
      };
      const uniqueTopLevel = (items) => {
        const unique = Array.from(new Set(items));
        return unique.filter((element) =>
          !unique.some((other) =>
            other !== element && other.contains(element)
          )
        );
      };

      const explicitSelectors = [
        "[data-pptx-slide]",
        ".pptx-slide",
        ".ppt-slide",
        ".reveal .slides > section",
        ".slides > section",
        ".slide",
        "[data-slide]",
        ".page"
      ];
      let candidates = [];
      // Selector priority matters. A generic outer page must not swallow
      // nested slide elements, and carousel-style decks often keep all but
      // the active slide hidden with opacity/visibility/display rules.
      for (const selector of explicitSelectors) {
        const matches = uniqueTopLevel(
          Array.from(document.querySelectorAll(selector))
        ).filter((element) => !element.matches("script, style, link"));
        if (matches.length > 0) {
          candidates = matches;
          break;
        }
      }
      let usedFallback = candidates.length === 0;

      if (candidates.length === 0) {
        const semanticSections = uniqueTopLevel(
          Array.from(document.querySelectorAll("section, article"))
            .filter(visible)
        );
        if (semanticSections.length >= 2) {
          const standalone = Array.from(document.body?.children || [])
            .filter((element) =>
              visible(element)
              && element.getBoundingClientRect().height >= 180
              && !semanticSections.some((section) => element.contains(section))
              && !element.matches("script, style, link, nav, footer")
            );
          candidates = [...standalone, ...semanticSections].sort((left, right) =>
            left === right
              ? 0
              : left.compareDocumentPosition(right)
                & Node.DOCUMENT_POSITION_FOLLOWING
                ? -1
                : 1
          );
        }
      }

      if (candidates.length === 0) {
        const markers = Array.from(document.querySelectorAll(
          ".section-title[id], [data-section-title], [id^='sec-']"
        )).filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none"
            && style.visibility !== "hidden"
            && Number(style.opacity || 1) > 0
            && rect.width >= 40
            && rect.height >= 1;
        });
        if (markers.length >= 2) {
          let common = markers[0]?.parentElement || document.body;
          while (
            common
            && !markers.every((marker) => common.contains(marker))
          ) {
            common = common.parentElement;
          }
          if (common && common !== document.body.parentElement) {
            const childUnder = (ancestor, node) => {
              let current = node;
              while (current.parentElement && current.parentElement !== ancestor) {
                current = current.parentElement;
              }
              return current;
            };
            const originalChildren = Array.from(common.children);
            const starts = Array.from(new Set(
              markers.map((marker) => childUnder(common, marker))
            )).sort((left, right) =>
              originalChildren.indexOf(left) - originalChildren.indexOf(right)
            );
            const startIndexes = starts.map((element) =>
              originalChildren.indexOf(element)
            );
            const ranges = [];
            if (startIndexes[0] > 0) {
              const prelude = originalChildren.slice(0, startIndexes[0])
                .filter((element) => !element.matches("script, style, link"));
              if (prelude.some(visible)) ranges.push(prelude);
            }
            starts.forEach((start, index) => {
              const from = originalChildren.indexOf(start);
              const to = index + 1 < starts.length
                ? originalChildren.indexOf(starts[index + 1])
                : originalChildren.length;
              ranges.push(originalChildren.slice(from, to));
            });
            candidates = ranges.filter((nodes) => nodes.length > 0).map(
              (nodes, index) => {
                const wrapper = document.createElement("div");
                wrapper.dataset.sierraPptxGeneratedGroup = String(index);
                wrapper.style.cssText = [
                  "position:relative",
                  "display:block",
                  "width:100%",
                  "box-sizing:border-box",
                  "overflow:visible"
                ].join(";");
                common.insertBefore(wrapper, nodes[0]);
                nodes.forEach((node) => wrapper.appendChild(node));
                return wrapper;
              }
            ).filter(visible);
          }
        }
      }

      if (candidates.length === 0 && document.body) {
        const primary = document.querySelector("body > main, body > article");
        const parent = primary && primary.children.length > 0
          ? primary
          : document.body;
        const blocks = Array.from(parent.children).filter(visible);
        if (blocks.length >= 2) candidates = blocks;
      }

      if (candidates.length === 0 && document.body) {
        candidates = [document.body];
      }

      const bodyStyle = document.body ? getComputedStyle(document.body) : null;
      const bodyBackground = bodyStyle?.backgroundColor || "rgb(255, 255, 255)";
      const candidateDisplay = candidates
        .map((element) => getComputedStyle(element).display)
        .find((display) => display !== "none") || "block";
      const logicalSizes = candidates.map((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          width: Math.max(
            1,
            element.offsetWidth || parseFloat(style.width) || rect.width
          ),
          height: Math.max(
            1,
            element.offsetHeight || parseFloat(style.height) || rect.height
          )
        };
      });
      const maxSlideWidth = Math.max(...logicalSizes.map((size) => size.width));
      const maxSlideHeight = Math.max(...logicalSizes.map((size) => size.height));
      candidates.forEach((element, index) => {
        const logicalSize = logicalSizes[index];
        element.setAttribute("data-sierra-pptx-slide", String(index));
        const style = getComputedStyle(element);
        if (
          style.backgroundColor === "rgba(0, 0, 0, 0)"
          || style.backgroundColor === "transparent"
        ) {
          element.style.backgroundColor = bodyBackground;
        }
        element.style.boxSizing = "border-box";
        element.style.setProperty("display", style.display === "none"
          ? candidateDisplay
          : style.display, "important");
        element.style.setProperty("visibility", "visible", "important");
        element.style.setProperty("opacity", "1", "important");
        element.style.setProperty("position", "relative", "important");
        element.style.setProperty("inset", "auto", "important");
        element.style.setProperty("transform", "none", "important");
        element.style.setProperty("transform-origin", "0 0", "important");
        element.style.setProperty("width", logicalSize.width + "px", "important");
        element.style.setProperty("height", logicalSize.height + "px", "important");
        element.style.setProperty("min-width", logicalSize.width + "px", "important");
        element.style.setProperty("min-height", logicalSize.height + "px", "important");
        element.style.setProperty("max-width", "none", "important");
        element.style.setProperty("max-height", "none", "important");
        element.style.setProperty("margin", "0", "important");
        // A slide root is the page canvas, not a card placed on the page.
        // Flatten only the outermost slide decoration; nested cards keep their
        // borders, shadows and rounded corners.
        element.style.border = "none";
        element.style.borderRadius = "0";
        element.style.boxShadow = "none";
        element.style.outline = "none";
        let ancestor = element.parentElement;
        while (ancestor && ancestor !== document.body) {
          ancestor.style.setProperty("overflow", "visible", "important");
          ancestor.style.setProperty("height", "auto", "important");
          ancestor.style.setProperty("max-height", "none", "important");
          ancestor.style.setProperty("min-width", maxSlideWidth + "px", "important");
          ancestor.style.setProperty("width", maxSlideWidth + "px", "important");
          ancestor.style.setProperty("transform", "none", "important");
          ancestor.style.setProperty("transform-origin", "0 0", "important");
          const ancestorPosition = getComputedStyle(ancestor).position;
          if (ancestorPosition === "fixed" || ancestorPosition === "absolute") {
            ancestor.style.setProperty("position", "relative", "important");
            ancestor.style.setProperty("inset", "auto", "important");
          }
          ancestor = ancestor.parentElement;
        }
      });

      if (document.documentElement) {
        document.documentElement.style.setProperty(
          "min-width", maxSlideWidth + "px", "important"
        );
      }
      if (document.body) {
        document.body.style.setProperty(
          "min-width", maxSlideWidth + "px", "important"
        );
      }

      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
      return {
        slides: candidates.length,
        usedFallback,
        documentWidth: Math.max(
          document.documentElement.scrollWidth,
          document.body?.scrollWidth || 0
        ),
        documentHeight: Math.max(
          document.documentElement.scrollHeight,
          document.body?.scrollHeight || 0
        ),
        maxSlideWidth,
        maxSlideHeight
      };
    })()`, true) as Promise<PreparedSlides>;
  }

  private async renderEditable(
    window: BrowserWindow,
    slideWidth: number,
    slideHeight: number,
    slideCount: number,
    warnings: string[],
    hybrid: boolean
  ): Promise<Buffer> {
    await window.webContents.executeJavaScript(`(async function () {
      document.querySelectorAll("[data-sierra-pptx-slide]").forEach((root) => {
        const containers = [
          root,
          ...Array.from(root.querySelectorAll(
            "div, section, article, main, aside, header, footer"
          ))
        ].reverse();
        containers.forEach((container) => {
          const containerRect = container.getBoundingClientRect();
          const style = getComputedStyle(container);
          const ownsStructuredLayout = [
            "grid",
            "inline-grid",
            "flex",
            "inline-flex"
          ].includes(style.display);
          const isVisualComposition = container.matches([
            "figure",
            "canvas",
            "svg",
            "[data-pptx-raster]",
            "[class*='chart']",
            "[class*='graph']",
            "[class*='plot']"
          ].join(",")) || !!container.querySelector(
            "[style*='--h:'], [style*='--w:'], [style*='--size:']"
          );
          if (
            style.display === "none"
            || style.visibility === "hidden"
            || Number(style.opacity || 1) <= 0
            || style.overflowY !== "visible"
            || ownsStructuredLayout
            || isVisualComposition
          ) {
            return;
          }
          let contentBottom = containerRect.bottom;
          Array.from(container.children).forEach((child) => {
            const childStyle = getComputedStyle(child);
            const childRect = child.getBoundingClientRect();
            if (
              childStyle.display !== "none"
              && childStyle.visibility !== "hidden"
              && childRect.width > 0
              && childRect.height > 0
            ) {
              contentBottom = Math.max(contentBottom, childRect.bottom);
            }
          });
          const requiredHeight = Math.ceil(contentBottom - containerRect.top);
          if (requiredHeight > containerRect.height + 1) {
            container.style.minHeight = requiredHeight + "px";
            container.style.height = "auto";
          }
        });
      });
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
    })()`, true);
    const flattenedBackgrounds = await flattenComplexSlideBackgrounds(window);
    if (flattenedBackgrounds > 0) {
      warnings.push(
        `${flattenedBackgrounds} 个多层渐变画布已固化为背景图，前景内容仍保持可编辑。`
      );
    }
    const rasterizedRegions = await rasterizeRiskyVisualRegions(window, !hybrid);
    if (rasterizedRegions > 0) {
      warnings.push(
        `${rasterizedRegions} 个浏览器专属复杂视觉区域已高清固化，其余文字与简单对象仍可编辑。`
      );
    }
    await materializeCssCounters(window);
    await window.webContents.executeJavaScript(`(function () {
      const roots = Array.from(
        document.querySelectorAll("[data-sierra-pptx-slide]")
      );
      roots.forEach((root) => {
        [root, ...Array.from(root.querySelectorAll("*"))].forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          if (!element.textContent?.trim() || element.querySelector("br")) return;

          // Only mark elements that own a simple text layout. Grid/flex/card
          // containers may happen to sit on one row but must keep their normal
          // wrapping behaviour for their descendants.
          const hasLayoutChild = Array.from(element.children).some((child) => {
            const display = getComputedStyle(child).display;
            return !["inline", "inline-block", "contents"].includes(display);
          });
          if (hasLayoutChild) return;

          const range = document.createRange();
          range.selectNodeContents(element);
          const textRects = Array.from(range.getClientRects()).filter(
            (rect) => rect.width > 0.5 && rect.height > 0.5
          );
          range.detach();
          if (textRects.length === 0) return;
          const lineTops = [];
          textRects.forEach((rect) => {
            if (!lineTops.some((top) => Math.abs(top - rect.top) <= 2)) {
              lineTops.push(rect.top);
            }
          });
          if (lineTops.length === 1) {
            element.style.setProperty("white-space", "nowrap", "important");
          }
        });
      });
    })()`, true);
    const metrics = await window.webContents.executeJavaScript(`(function () {
      const PX_TO_INCH = 1 / 96;
      const EMU_PER_INCH = ${EMU_PER_INCH};
      return Array.from(
        document.querySelectorAll("[data-sierra-pptx-slide]")
      ).map((root) => {
        const rootRect = root.getBoundingClientRect();
        const contentWidth = Math.max(1, rootRect.width * PX_TO_INCH);
        const contentHeight = Math.max(1, rootRect.height * PX_TO_INCH);
        const scale = Math.min(
          ${slideWidth} / contentWidth,
          ${slideHeight} / contentHeight
        );
        const tables = Array.from(root.querySelectorAll("table"))
          .filter((table) => {
            const rect = table.getBoundingClientRect();
            const style = getComputedStyle(table);
            return rect.width > 0
              && rect.height > 0
              && style.display !== "none"
              && style.visibility !== "hidden";
          })
          .map((table) => ({
            rowHeights: Array.from(table.rows).map((row) =>
              Math.max(
                1,
                Math.round(
                  row.getBoundingClientRect().height
                  * PX_TO_INCH
                  * scale
                  * EMU_PER_INCH
                )
              )
            )
          }));
        return { tables };
      });
    })()`, true) as EditableSlideMetric[];
    const nativeCharts = await window.webContents.executeJavaScript(
      nativeChartExtractionScript(slideWidth, slideHeight),
      true
    ) as NativeChartExtraction;
    const bundle = await readFile(browserBundlePath(), "utf8");
    await window.webContents.executeJavaScript(
      `${bundle}\n//# sourceURL=sierra-dom-to-pptx.bundle.js`,
      true
    );
    await window.webContents.executeJavaScript(`(function () {
      if (!window.domToPptx?.exportToPptx) {
        throw new Error("PowerPoint conversion engine failed to initialize");
      }
      document.querySelectorAll("canvas").forEach((canvas) => {
        try {
          const rect = canvas.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) return;
          const image = document.createElement("img");
          image.src = canvas.toDataURL("image/png");
          image.alt = canvas.getAttribute("aria-label")
            || canvas.getAttribute("title")
            || "图表";
          image.width = Math.max(1, Math.round(rect.width));
          image.height = Math.max(1, Math.round(rect.height));
          image.style.cssText = canvas.style.cssText;
          image.style.display = getComputedStyle(canvas).display === "inline"
            ? "inline-block"
            : getComputedStyle(canvas).display;
          image.style.width = rect.width + "px";
          image.style.height = rect.height + "px";
          image.style.objectFit = "contain";
          canvas.replaceWith(image);
        } catch {
          // A tainted canvas cannot be serialized; leave it for the converter.
        }
      });
    })()`, true);
    const chunks: Buffer[] = [];
    for (
      let start = 0;
      start < slideCount;
      start += EDITABLE_EXPORT_CHUNK_SIZE
    ) {
      const end = Math.min(slideCount, start + EDITABLE_EXPORT_CHUNK_SIZE);
      const base64 = await window.webContents.executeJavaScript(`(async function () {
        const targets = Array.from(
          document.querySelectorAll("[data-sierra-pptx-slide]")
        ).slice(${start}, ${end});
        const blob = await window.domToPptx.exportToPptx(targets, {
          width: ${slideWidth},
          height: ${slideHeight},
          skipDownload: true,
          svgAsVector: true,
          // PowerPoint renders the converter's embedded OpenType subsets with
          // duplicated glyph outlines on some Windows/Office builds. Keep the
          // requested font names in OOXML and use the locally installed fonts.
          autoEmbedFonts: false,
          fonts: []
        });
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      })()`, true) as string;
      chunks.push(Buffer.from(base64, "base64"));
    }
    if (chunks.length > 1) {
      warnings.push(
        `${slideCount} 页内容已分 ${chunks.length} 批转换并合并，所有页面仍保持可编辑。`
      );
    }
    const editableOutput = await mergeEditablePptxChunks(chunks);
    const normalized = await normalizeEditablePptx(
      editableOutput,
      metrics
    );
    if (nativeCharts.skipped.length > 0) {
      warnings.push(
        `${nativeCharts.skipped.length} 个复杂图表为保持原设计，已保留为高清图片或矢量快照。`
      );
    }
    if (nativeCharts.overlays.length === 0) return normalized;
    try {
      const merged = await mergeNativeChartsIntoPptx(
        normalized,
        nativeCharts.overlays,
        slideCount,
        slideWidth,
        slideHeight
      );
      warnings.push(
        `${nativeCharts.overlays.length} 个简单图表已转换为可编辑的 PowerPoint 原生图表。`
      );
      return merged;
    } catch (error) {
      warnings.push(
        `原生图表转换未完成，已安全保留视觉快照：${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return normalized;
    }
  }

  private async renderFidelity(
    window: BrowserWindow,
    slideWidth: number,
    slideHeight: number,
    viewportHeight: number
  ): Promise<Buffer> {
    const targets = await window.webContents.executeJavaScript(`(function () {
      return Array.from(
        document.querySelectorAll("[data-sierra-pptx-slide]")
      ).map((element, index) => {
        const rect = element.getBoundingClientRect();
        return {
          index,
          width: Math.ceil(rect.width),
          height: Math.ceil(rect.height)
        };
      });
    })()`, true) as CaptureTarget[];

    const pptx = new PptxGenJS();
    pptx.defineLayout({
      name: "SIERRA_CUSTOM",
      width: slideWidth,
      height: slideHeight
    });
    pptx.layout = "SIERRA_CUSTOM";
    pptx.author = "SierraStudio";
    pptx.subject = "High-fidelity HTML export";
    pptx.title = "SierraStudio PowerPoint export";

    for (const target of targets) {
      const slide = pptx.addSlide();
      const aspect = target.width / target.height;
      const slideAspect = slideWidth / slideHeight;
      let width = slideWidth;
      let height = slideHeight;
      let x = 0;
      let y = 0;
      if (aspect > slideAspect) {
        height = slideWidth / aspect;
        y = (slideHeight - height) / 2;
      } else {
        width = slideHeight * aspect;
        x = (slideWidth - width) / 2;
      }
      slide.background = { color: "FFFFFF" };

      const segmentLimit = Math.max(1, viewportHeight);
      for (
        let offset = 0;
        offset < Math.max(1, target.height);
        offset += segmentLimit
      ) {
        const requestedHeight = Math.min(
          segmentLimit,
          Math.max(1, target.height - offset)
        );
        const clip = await window.webContents.executeJavaScript(`(async function () {
          const element = document.querySelector(
            '[data-sierra-pptx-slide="${target.index}"]'
          );
          if (!element) throw new Error("Slide element disappeared during export");
          const initialRect = element.getBoundingClientRect();
          const absoluteTop = initialRect.top + window.scrollY;
          window.scrollTo({
            left: Math.max(0, initialRect.left + window.scrollX),
            top: Math.max(0, absoluteTop + ${offset}),
            behavior: "instant"
          });
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          );
          const rect = element.getBoundingClientRect();
          const clipX = Math.max(0, Math.floor(rect.left));
          const clipY = Math.max(0, Math.floor(rect.top + ${offset}));
          return {
            x: clipX,
            y: clipY,
            width: Math.max(1, Math.min(
              window.innerWidth - clipX,
              Math.ceil(rect.width)
            )),
            height: Math.max(1, Math.min(
              window.innerHeight - clipY,
              ${requestedHeight}
            ))
          };
        })()`, true) as Electron.Rectangle;
        const image = await window.webContents.capturePage(clip);
        const capturedHeight = Math.min(
          requestedHeight,
          image.getSize().height
        );
        slide.addImage({
          data: `data:image/png;base64,${image.toPNG().toString("base64")}`,
          x,
          y: y + (offset / target.height) * height,
          w: width,
          h: (capturedHeight / target.height) * height
        });
      }
    }
    const output = await pptx.write({
      outputType: "nodebuffer",
      compression: true
    });
    return asBuffer(output);
  }
}
