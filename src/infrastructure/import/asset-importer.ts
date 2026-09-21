import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { basename, dirname, extname, join, resolve } from "node:path";
import postcss, {
  type AtRule,
  type Container,
  type Declaration
} from "postcss";
import valueParser, { type Node as ValueNode } from "postcss-value-parser";
import { parseHTML } from "linkedom";
import type { AssetRecord } from "../sqlite/project-database";
import { atomicWriteFile } from "../filesystem/atomic-files";
import type { ImportCompatibilityReport } from "../../shared/import-compatibility";
import { detectRuntimeStyle } from "../../domain/document/runtime-dependencies";
import { scanImportCompatibility } from "./compatibility-scanner";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".css": "text/css",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "video/ogg",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

const URL_ATTRIBUTES = [
  ["img", "src"],
  ["source", "src"],
  ["video", "poster"],
  ["link[rel='stylesheet']", "href"],
  ["script", "src"],
  ["object", "data"],
  ["image", "href"],
  ["use", "href"]
] as const;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
  "font/otf": ".otf",
  "font/ttf": ".ttf",
  "font/woff": ".woff",
  "font/woff2": ".woff2",
  "text/css": ".css",
  "video/mp4": ".mp4",
  "video/ogg": ".ogg",
  "video/webm": ".webm"
};
const REMOTE_URL_PATTERN = /https?:\/\/[^\s"'`()<>]+/gi;
const MAX_REMOTE_ASSET_BYTES = 20 * 1024 * 1024;
const REMOTE_IMPORT_BUDGET_MS = 8_000;
const REMOTE_REQUEST_TIMEOUT_MS = 3_000;
const REMOTE_IMAGE_FALLBACK = `data:image/svg+xml;base64,${
  Buffer.from(
    "<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360' "
    + "viewBox='0 0 640 360'><rect width='640' height='360' fill='#eef1f5'/>"
    + "<path d='M210 250l75-82 54 58 42-45 69 69H210z' fill='#c3cad5'/>"
    + "<circle cx='260' cy='120' r='24' fill='#c3cad5'/>"
    + "<text x='320' y='310' text-anchor='middle' font-family='sans-serif' "
    + "font-size='18' fill='#727b89'>远程图片未下载</text></svg>",
    "utf8"
  ).toString("base64")
}`;

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function isLocalReference(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized)
    && !normalized.startsWith("#")
    && !normalized.startsWith("data:")
    && !normalized.startsWith("blob:")
    && !normalized.startsWith("http:")
    && !normalized.startsWith("https:")
    && !normalized.startsWith("//");
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9")
    || normalized.startsWith("fea") || normalized.startsWith("feb")) {
    return true;
  }
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const ipv4 = mapped ?? (isIP(address) === 4 ? address : null);
  if (!ipv4) return false;
  const [a = -1, b = -1] = ipv4.split(".").map(Number);
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function looksLikeRemoteImage(value: string): boolean {
  try {
    const url = new URL(value);
    return /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(url.pathname)
      || /(?:images\.unsplash\.com|images\.pexels\.com)$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function isOptionalRemoteFontStylesheet(value: string): boolean {
  const match = value.match(/https?:\/\/[^\s"'()]+/i)?.[0];
  if (!match) return false;
  try {
    const hostname = new URL(match).hostname.toLowerCase();
    return hostname === "fonts.googleapis.com"
      || hostname === "fonts.bunny.net"
      || hostname === "use.typekit.net"
      || hostname.endsWith(".fonts.net");
  } catch {
    return false;
  }
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function withoutQueryOrHash(value: string): string {
  return value.split(/[?#]/, 1)[0] ?? value;
}

/**
 * linkedom treats the first top-level element as documentElement when an HTML
 * file omits its opening <html>/<head> tags. A browser repairs that markup,
 * but serializing linkedom's result would otherwise keep only that first node
 * (commonly <title>) and silently discard the page body.
 */
export function normalizeImportedDocumentShell(sourceHtml: string): string {
  if (/<html(?:\s|>)/i.test(sourceHtml)) return sourceHtml;

  const doctypeMatch = sourceHtml.match(/^\s*(<!doctype\s+html[^>]*>)/i);
  const doctype = doctypeMatch?.[1] ?? "<!doctype html>";
  const markup = doctypeMatch
    ? sourceHtml.slice(doctypeMatch[0].length)
    : sourceHtml;
  const bodyIndex = markup.search(/<body(?:\s|>)/i);
  const hasClosingHtml = /<\/html\s*>/i.test(markup);
  let contents: string;

  if (bodyIndex >= 0) {
    const beforeBody = markup.slice(0, bodyIndex);
    const bodyAndAfter = markup.slice(bodyIndex);
    if (/<head(?:\s|>)/i.test(beforeBody)) {
      contents = `${beforeBody}${bodyAndAfter}`;
    } else {
      const headContents = beforeBody.replace(/<\/head\s*>\s*$/i, "");
      contents = `<head>${headContents}</head>${bodyAndAfter}`;
    }
  } else if (/<head(?:\s|>)/i.test(markup)) {
    contents = markup;
  } else {
    contents = `<head></head><body>${markup}</body>`;
  }

  return `${doctype}\n<html>${contents}${hasClosingHtml ? "" : "</html>"}`;
}

function svgNumber(element: Element, name: string, fallback = 0): number {
  const value = Number.parseFloat(element.getAttribute(name) ?? "");
  return Number.isFinite(value) ? value : fallback;
}

function svgColorWithOpacity(color: string, opacityValue: string | null): string {
  if (opacityValue === null) return color;
  const opacity = Number.parseFloat(opacityValue);
  if (!Number.isFinite(opacity) || opacity >= 1) return color;
  const hex = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const normalized = hex.length === 3
      ? [...hex].map((character) => `${character}${character}`).join("")
      : hex;
    return `rgba(${Number.parseInt(normalized.slice(0, 2), 16)}, ${Number.parseInt(normalized.slice(2, 4), 16)}, ${Number.parseInt(normalized.slice(4, 6), 16)}, ${opacity})`;
  }
  const rgb = color.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  return rgb ? `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${opacity})` : color;
}

function svgPaint(svg: SVGSVGElement, element: Element, name: string): string {
  const raw = element.getAttribute(name)
    ?? (element.getAttribute("class")?.includes("s-muted")
      ? "var(--muted)"
      : element.getAttribute("class")?.includes("s-card")
        ? "var(--card)"
        : element.getAttribute("class")?.includes("s-fg")
          ? "var(--fg)"
          : "transparent");
  const reference = raw.match(/^url\(#([^)]+)\)$/)?.[1];
  if (!reference) return raw;
  const gradient = [...svg.querySelectorAll("linearGradient, lineargradient, radialGradient, radialgradient")]
    .find((candidate) => candidate.getAttribute("id") === reference);
  if (!gradient) return "transparent";
  const stops = [...gradient.querySelectorAll("stop")].map((stop) => {
    const color = svgColorWithOpacity(
      stop.getAttribute("stop-color") ?? "transparent",
      stop.getAttribute("stop-opacity")
    );
    const offset = stop.getAttribute("offset") ?? "0%";
    return `${color} ${offset}`;
  });
  // A CSS gradient is exported as a small SVG picture. Use its leading color
  // for explicit editable diagrams so the corresponding box stays a native
  // PowerPoint shape; the diagram keeps its hierarchy with a minimal visual
  // tradeoff.
  return stops[0]?.replace(/\s+(?:\d+(?:\.\d+)?%?|\.\d+)$/, "")
    ?? "transparent";
}

/** Convert explicitly-authored SVG diagrams into normal positioned HTML. */
export function materializeEditableSvgDiagrams(document: Document): number {
  let converted = 0;
  for (const svg of document.querySelectorAll<SVGSVGElement>(
    ".diagram-svg > svg"
  )) {
    const viewBox = (svg.getAttribute("viewBox") ?? "")
      .trim().split(/[\s,]+/).map(Number);
    if (viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) {
      continue;
    }
    const minX = viewBox[0]!;
    const minY = viewBox[1]!;
    const width = viewBox[2]!;
    const height = viewBox[3]!;
    if (width <= 0 || height <= 0) continue;
    if (svg.getAttribute("height")?.trim().toLowerCase() === "auto") {
      svg.removeAttribute("height");
    }
    // Keep compact strip diagrams intact: their curved/command-relative paths
    // carry more information than a box-and-text materialization can retain.
    if (width / height > 4) continue;
    const replacement = document.createElement("div");
    replacement.className = "hs-editable-svg-diagram";
    replacement.setAttribute("data-hs-svg-materialized", "true");
    replacement.setAttribute(
      "style",
      `position:relative;width:100%;aspect-ratio:${width}/${height};overflow:visible`
    );
    const pctX = (value: number): number => (value - minX) / width * 100;
    const pctY = (value: number): number => (value - minY) / height * 100;
    const addLine = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      source: Element
    ): void => {
      const line = document.createElement("div");
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      const stroke = svgPaint(svg, source, "stroke");
      const strokeWidth = svgNumber(source, "stroke-width", 1);
      line.setAttribute(
        "style",
        [
          "position:absolute",
          `left:${pctX(x1)}%`,
          `top:${pctY(y1)}%`,
          `width:${length / width * 100}%`,
          `height:${strokeWidth}px`,
          `background:${stroke}`,
          `transform:rotate(${angle}deg)`,
          "transform-origin:0 0",
          `opacity:${source.getAttribute("opacity") ?? "1"}`
        ].join(";")
      );
      replacement.appendChild(line);
    };

    for (const element of svg.querySelectorAll("rect, circle, line, path, text")) {
      const tag = element.tagName.toLowerCase();
      if (tag === "rect") {
        const box = document.createElement("div");
        const x = svgNumber(element, "x");
        const y = svgNumber(element, "y");
        const boxWidth = svgNumber(element, "width");
        const boxHeight = svgNumber(element, "height");
        const stroke = svgPaint(svg, element, "stroke");
        const strokeWidth = svgNumber(element, "stroke-width");
        box.setAttribute("style", [
          "position:absolute",
          `left:${pctX(x)}%`,
          `top:${pctY(y)}%`,
          `width:${boxWidth / width * 100}%`,
          `height:${boxHeight / height * 100}%`,
          `background:${svgPaint(svg, element, "fill")}`,
          `border:${strokeWidth > 0 && stroke !== "transparent" ? `${strokeWidth}px solid ${stroke}` : "0"}`,
          `border-radius:${svgNumber(element, "rx")}px`,
          `opacity:${element.getAttribute("opacity") ?? "1"}`,
          "box-sizing:border-box"
        ].join(";"));
        replacement.appendChild(box);
      } else if (tag === "circle") {
        const circle = document.createElement("div");
        const cx = svgNumber(element, "cx");
        const cy = svgNumber(element, "cy");
        const radius = svgNumber(element, "r");
        circle.setAttribute("style", [
          "position:absolute",
          `left:${pctX(cx - radius)}%`,
          `top:${pctY(cy - radius)}%`,
          `width:${radius * 2 / width * 100}%`,
          `height:${radius * 2 / height * 100}%`,
          `background:${svgPaint(svg, element, "fill")}`,
          `border:${svgNumber(element, "stroke-width") || 0}px solid ${svgPaint(svg, element, "stroke")}`,
          "border-radius:50%",
          `opacity:${element.getAttribute("opacity") ?? "1"}`,
          "box-sizing:border-box"
        ].join(";"));
        replacement.appendChild(circle);
      } else if (tag === "line") {
        addLine(
          svgNumber(element, "x1"), svgNumber(element, "y1"),
          svgNumber(element, "x2"), svgNumber(element, "y2"), element
        );
      } else if (tag === "path") {
        const values = (element.getAttribute("d") ?? "")
          .match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
        for (let index = 0; index + 3 < values.length; index += 2) {
          addLine(
            values[index]!, values[index + 1]!,
            values[index + 2]!, values[index + 3]!, element
          );
        }
      } else if (tag === "text") {
        const text = document.createElement("div");
        const anchor = element.getAttribute("text-anchor") ?? "start";
        const fontSize = svgNumber(element, "font-size", 12);
        const letterSpacing = element.getAttribute("letter-spacing");
        text.textContent = element.textContent ?? "";
        text.setAttribute("style", [
          "position:absolute",
          `left:${pctX(svgNumber(element, "x"))}%`,
          `top:${pctY(svgNumber(element, "y") - fontSize)}%`,
          `transform:translateX(${anchor === "middle" ? "-50%" : anchor === "end" ? "-100%" : "0"})`,
          `color:${svgPaint(svg, element, "fill")}`,
          `font-size:${fontSize}px`,
          `font-weight:${element.getAttribute("font-weight") ?? "400"}`,
          `font-style:${element.getAttribute("font-style") ?? "normal"}`,
          `letter-spacing:${letterSpacing === null ? "normal" : Number.isFinite(Number(letterSpacing)) ? `${letterSpacing}px` : letterSpacing}`,
          "line-height:1.15",
          "white-space:nowrap",
          `opacity:${element.getAttribute("opacity") ?? "1"}`
        ].join(";"));
        replacement.appendChild(text);
      }
    }
    svg.replaceWith(replacement);
    converted += 1;
  }
  return converted;
}

function serializeDocument(document: Document): string {
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

export interface ImportResult {
  html: string;
  assets: AssetRecord[];
  warnings: string[];
  compatibility: ImportCompatibilityReport;
}

export class AssetImporter {
  private readonly importedBySource = new Map<string, string>();
  private readonly importedRemote = new Map<string, string>();
  private readonly importingRemote = new Set<string>();
  private readonly records: AssetRecord[] = [];
  private readonly warnings: string[] = [];
  private readonly remoteImportDeadline = Date.now() + REMOTE_IMPORT_BUDGET_MS;
  private readonly skippedFontStylesheets = new Set<string>();

  constructor(private readonly projectRoot: string) {}

  async importHtml(sourcePath: string, sourceHtml: string): Promise<ImportResult> {
    const compatibility = scanImportCompatibility(sourceHtml);
    const { document } = parseHTML(normalizeImportedDocumentShell(sourceHtml));
    const htmlDirectory = dirname(sourcePath);
    const baseHref = document.querySelector("base[href]")?.getAttribute("href");
    let htmlBase: string = htmlDirectory;
    if (baseHref) {
      if (/^https:\/\//i.test(baseHref)) {
        htmlBase = baseHref;
      } else if (isLocalReference(baseHref)) {
        const resolvedBase = resolve(
          htmlDirectory,
          decodeURIComponent(withoutQueryOrHash(baseHref))
        );
        htmlBase = /[\\/]$/.test(baseHref)
          ? resolvedBase
          : dirname(resolvedBase);
      }
    }

    for (const [selector, attribute] of URL_ATTRIBUTES) {
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        const current = element.getAttribute(attribute);
        if (!current) continue;
        try {
          if (
            selector === "link[rel='stylesheet']"
            && attribute === "href"
            && /^https:\/\//i.test(current)
            && detectRuntimeStyle(current)
          ) {
            element.setAttribute("data-hs-original-href", current);
            continue;
          }
          const localized = await this.localizeReference(
            current,
            htmlBase,
            selector !== "script" && selector !== "object"
          );
          if (localized) {
            element.setAttribute(attribute, localized);
          } else if (
            /^https:\/\//i.test(current)
            && looksLikeRemoteImage(current)
            && (
              selector === "img"
              || selector === "image"
              || (selector === "video" && attribute === "poster")
            )
          ) {
            element.setAttribute(attribute, REMOTE_IMAGE_FALLBACK);
            element.setAttribute("data-hs-remote-unavailable", current);
          }
        } catch (error) {
          this.warnings.push(
            `无法本地化资源 ${current}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }

    for (const element of document.querySelectorAll<HTMLElement>("[srcset]")) {
      const srcset = element.getAttribute("srcset");
      if (!srcset) continue;
      if (srcset.trim().toLowerCase().startsWith("data:")) continue;
      const candidates = srcset.split(",");
      const rewritten: string[] = [];
      for (const candidate of candidates) {
        const [reference, ...descriptor] = candidate.trim().split(/\s+/);
        if (!reference) continue;
        const localized = await this.localizeReference(
          reference,
          htmlBase,
          true
        );
        rewritten.push([localized ?? reference, ...descriptor].join(" "));
      }
      element.setAttribute("srcset", rewritten.join(", "));
    }

    for (const style of document.querySelectorAll("style")) {
      try {
        style.textContent = await this.rewriteCss(
          style.textContent ?? "",
          htmlBase
        );
      } catch (error) {
        this.warnings.push(
          `内联样式解析失败，已保留原文: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    for (const element of document.querySelectorAll<HTMLElement>("[style]")) {
      const css = element.getAttribute("style");
      if (!css) continue;
      try {
        const root = postcss.parse(`x{${css}}`);
        const rule = root.first;
        if (rule && "nodes" in rule) {
          await this.rewriteCssNodes(rule, htmlBase);
          element.setAttribute(
            "style",
            (rule.nodes ?? [])
              .map((node) => node.toString())
              .join(";")
          );
        }
      } catch (error) {
        this.warnings.push(
          `style 属性解析失败，已保留原文: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Runtime-generated cards often keep image URLs inside JavaScript data
    // and template strings. Only replace URLs whose response is a safe,
    // display-only asset; scripts and JSON endpoints are never imported.
    for (const script of document.querySelectorAll<HTMLScriptElement>(
      "script:not([src])"
    )) {
      let content = script.textContent ?? "";
      const remoteUrls = [...new Set(content.match(REMOTE_URL_PATTERN) ?? [])];
      for (const remoteUrl of remoteUrls) {
        const localized = await this.localizeRemoteAsset(remoteUrl);
        if (localized) {
          content = content.replaceAll(remoteUrl, localized);
        } else if (looksLikeRemoteImage(remoteUrl)) {
          content = content.replaceAll(remoteUrl, REMOTE_IMAGE_FALLBACK);
        }
      }
      script.textContent = content;
    }

    // All references have now been resolved against the original base. Keeping
    // <base> would make the localized ../assets URLs point somewhere else.
    document.querySelectorAll("base").forEach((element) => element.remove());
    materializeEditableSvgDiagrams(document);

    return {
      html: serializeDocument(document),
      assets: this.records,
      warnings: this.warnings,
      compatibility
    };
  }

  private async localizeReference(
    reference: string,
    baseLocation: string,
    allowRemote = true
  ): Promise<string | undefined> {
    if (/^https:\/\//i.test(reference)) {
      return allowRemote
        ? this.localizeRemoteAsset(reference)
        : undefined;
    }
    if (!isLocalReference(reference)) return undefined;
    if (/^https:\/\//i.test(baseLocation)) {
      return allowRemote
        ? this.localizeRemoteAsset(new URL(reference, baseLocation).toString())
        : undefined;
    }
    let sourcePath: string;
    try {
      sourcePath = resolve(
        baseLocation,
        decodeURIComponent(withoutQueryOrHash(reference))
      );
      if (!(await stat(sourcePath)).isFile()) return undefined;
    } catch {
      return undefined;
    }
    const existing = this.importedBySource.get(sourcePath);
    if (existing) return existing;

    const extension = extname(sourcePath).toLowerCase();
    if (extension === ".css") {
      // Reserve the source to break accidental circular @import chains.
      this.importedBySource.set(sourcePath, reference);
      const originalCss = await readFile(sourcePath, "utf8");
      let css = originalCss;
      try {
        css = await this.rewriteCss(originalCss, dirname(sourcePath));
      } catch (error) {
        this.warnings.push(
          `CSS ${sourcePath} 解析失败，已原样复制: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      const data = Buffer.from(css, "utf8");
      return this.storeAsset(sourcePath, data, ".css");
    }
    return this.storeAsset(sourcePath, await readFile(sourcePath), extension);
  }

  private async assertPublicRemoteUrl(url: URL): Promise<void> {
    if (url.protocol !== "https:") {
      throw new Error("仅允许下载 HTTPS 资源");
    }
    if (url.username || url.password) {
      throw new Error("不允许带认证信息的远程资源");
    }
    const addresses = await lookup(url.hostname, { all: true });
    if (
      addresses.length === 0
      || addresses.some(({ address }) => isPrivateAddress(address))
    ) {
      throw new Error("已阻止本机、私网或保留地址");
    }
  }

  private async fetchRemoteAsset(
    source: string
  ): Promise<{ data: Uint8Array; mimeType: string; finalUrl: string } | null> {
    let current = new URL(source);
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const remainingBudget = this.remoteImportDeadline - Date.now();
      if (remainingBudget <= 0) {
        throw new Error("远程资源等待预算已用完，已跳过");
      }
      const requestTimeout = Math.max(
        1,
        Math.min(REMOTE_REQUEST_TIMEOUT_MS, remainingBudget)
      );
      await withTimeout(
        this.assertPublicRemoteUrl(current),
        requestTimeout,
        "远程资源地址解析超时"
      );
      const response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(requestTimeout),
        headers: {
          "user-agent": "SierraStudio/0.1 asset-importer",
          accept: "image/*,font/*,text/css,video/*;q=0.8"
        }
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirects === 3) {
          throw new Error("远程资源重定向过多或缺少目标");
        }
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) {
        throw new Error(`远程服务器返回 ${response.status}`);
      }
      const mimeType = (
        response.headers.get("content-type")?.split(";", 1)[0] ?? ""
      ).toLowerCase();
      if (
        !mimeType.startsWith("image/")
        && !mimeType.startsWith("font/")
        && !mimeType.startsWith("video/")
        && mimeType !== "text/css"
        && mimeType !== "application/font-woff"
      ) {
        return null;
      }
      const announcedSize = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(announcedSize)
        && announcedSize > MAX_REMOTE_ASSET_BYTES
      ) {
        throw new Error("远程资源超过 20 MB 限制");
      }
      if (!response.body) return null;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_REMOTE_ASSET_BYTES) {
          await reader.cancel();
          throw new Error("远程资源超过 20 MB 限制");
        }
        chunks.push(value);
      }
      const data = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { data, mimeType, finalUrl: current.toString() };
    }
    return null;
  }

  private async localizeRemoteAsset(
    source: string
  ): Promise<string | undefined> {
    const existing = this.importedRemote.get(source);
    if (existing) return existing;
    if (this.importingRemote.has(source)) return undefined;
    this.importingRemote.add(source);
    try {
      const fetched = await this.fetchRemoteAsset(source);
      if (!fetched) return undefined;
      let data = fetched.data;
      let extension = EXTENSION_BY_MIME[fetched.mimeType]
        ?? extname(new URL(fetched.finalUrl).pathname).toLowerCase();
      if (fetched.mimeType === "application/font-woff") extension = ".woff";
      if (fetched.mimeType === "text/css") {
        let css = new TextDecoder().decode(data);
        css = await this.rewriteRemoteCss(css, fetched.finalUrl);
        data = new TextEncoder().encode(css);
      }
      const localized = await this.storeAsset(
        source,
        data,
        extension,
        fetched.mimeType,
        basename(new URL(fetched.finalUrl).pathname) || "remote-asset"
      );
      this.importedRemote.set(source, localized);
      return localized;
    } catch (error) {
      this.warnings.push(
        `无法离线化远程资源 ${source}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return undefined;
    } finally {
      this.importingRemote.delete(source);
    }
  }

  private async rewriteRemoteCss(
    css: string,
    stylesheetUrl: string
  ): Promise<string> {
    const root = postcss.parse(css);
    const targets: Array<Declaration | AtRule> = [];
    root.walkDecls((declaration) => {
      targets.push(declaration);
    });
    root.walkAtRules("import", (rule) => {
      targets.push(rule);
    });
    for (const target of targets) {
      const value = target.type === "decl" ? target.value : target.params;
      const parsed = valueParser(value);
      const nodes: ValueNode[] = [];
      parsed.walk((node) => {
        if (
          node.type === "function"
          && node.value.toLowerCase() === "url"
        ) {
          nodes.push(node);
        } else if (
          target.type === "atrule"
          && node.type === "string"
          && nodes.length === 0
        ) {
          nodes.push(node);
        }
      });
      for (const node of nodes) {
        const raw = node.type === "function"
          ? valueParser.stringify(node.nodes).trim()
            .replace(/^['"]|['"]$/g, "")
          : node.value;
        const absolute = new URL(raw, stylesheetUrl).toString();
        const localized = await this.localizeRemoteAsset(absolute);
        const replacement = localized
          ?? (looksLikeRemoteImage(absolute)
            ? REMOTE_IMAGE_FALLBACK
            : undefined);
        if (!replacement) continue;
        if (node.type === "function") {
          node.nodes = [{
            type: "word",
            value: replacement,
            sourceIndex: 0,
            sourceEndIndex: replacement.length
          }];
        } else {
          node.value = replacement;
        }
      }
      if (target.type === "decl") target.value = parsed.toString();
      else target.params = parsed.toString();
    }
    return root.toString();
  }

  private async storeAsset(
    sourcePath: string,
    data: Uint8Array,
    extension: string,
    mimeType = MIME_BY_EXTENSION[extension] ?? "application/octet-stream",
    originalName = basename(sourcePath)
  ): Promise<string> {
    const hash = sha256(data);
    const safeExtension = extension || "";
    const fileName = `${hash}${safeExtension}`;
    const relativeReference = `../assets/${fileName}`;
    await mkdir(join(this.projectRoot, "assets"), { recursive: true });
    await atomicWriteFile(join(this.projectRoot, "assets", fileName), data);
    this.importedBySource.set(sourcePath, relativeReference);
    this.records.push({
      id: `asset_${randomUUID()}`,
      sha256: hash,
      mimeType,
      byteSize: data.byteLength,
      storedPath: `assets/${fileName}`,
      originalName,
      originalUri: sourcePath
    });
    return relativeReference;
  }

  private async rewriteCss(css: string, baseDirectory: string): Promise<string> {
    const root = postcss.parse(css);
    await this.rewriteCssNodes(root, baseDirectory);
    return root.toString();
  }

  private async rewriteCssNodes(
    container: Container,
    baseDirectory: string
  ): Promise<void> {
    const declarations: Declaration[] = [];
    const imports: AtRule[] = [];
    container.walkDecls((declaration) => {
      declarations.push(declaration);
    });
    container.walkAtRules("import", (rule) => {
      imports.push(rule);
    });

    for (const declaration of declarations) {
      declaration.value = await this.rewriteCssValue(
        declaration.value,
        baseDirectory
      );
    }
    for (const rule of imports) {
      if (isOptionalRemoteFontStylesheet(rule.params)) {
        if (!this.skippedFontStylesheets.has(rule.params)) {
          this.skippedFontStylesheets.add(rule.params);
          this.warnings.push(
            "已跳过远程字体下载，编辑与离线导出将使用系统回退字体"
          );
        }
        rule.remove();
        continue;
      }
      rule.params = await this.rewriteCssValue(rule.params, baseDirectory, true);
    }
  }

  private async rewriteCssValue(
    value: string,
    baseDirectory: string,
    importString = false
  ): Promise<string> {
    const parsed = valueParser(value);
    const targets: ValueNode[] = [];
    parsed.walk((node) => {
      if (node.type === "function" && node.value.toLowerCase() === "url") {
        targets.push(node);
      } else if (
        importString
        && node.type === "string"
        && targets.length === 0
      ) {
        targets.push(node);
      }
    });

    for (const target of targets) {
      const raw = target.type === "function"
        ? valueParser.stringify(target.nodes).trim().replace(/^['"]|['"]$/g, "")
        : target.value;
      const localized = await this.localizeReference(raw, baseDirectory);
      const replacement = localized
        ?? (/^https:\/\//i.test(raw) && looksLikeRemoteImage(raw)
          ? REMOTE_IMAGE_FALLBACK
          : undefined);
      if (!replacement) continue;
      if (target.type === "function") {
        target.nodes = [{
          type: "word",
          value: replacement,
          sourceIndex: 0,
          sourceEndIndex: replacement.length
        }];
      } else {
        target.value = replacement;
      }
    }
    return parsed.toString();
  }
}
