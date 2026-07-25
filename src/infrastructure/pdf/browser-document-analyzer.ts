import type { WebContents } from "electron";
import type { PaginationHints } from "../../domain/pdf/smart-pagination";

export interface DocumentMeasurement {
  width: number;
  height: number;
  images: number;
  failedImages: number;
  frozenViewportProperties: number;
}

async function execute<T>(
  webContents: WebContents,
  source: string
): Promise<T> {
  return webContents.executeJavaScript(source, true) as Promise<T>;
}

export async function stabilizeForPdf(
  webContents: WebContents
): Promise<number> {
  return execute<number>(webContents, `(async function () {
    const style = document.createElement("style");
    style.textContent = \`
      @page { margin: 0; }
      html {
        scroll-behavior: auto !important;
        scroll-snap-type: none !important;
      }
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
        print-color-adjust: exact !important;
        -webkit-print-color-adjust: exact !important;
      }
      .dots, [data-long-pdf-hide], [data-hs-overlay] {
        display: none !important;
      }
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
        break-before: auto !important;
        break-after: auto !important;
        page-break-before: auto !important;
        page-break-after: auto !important;
      }
    \`;
    document.head.appendChild(style);
    if (document.fonts?.ready) await document.fonts.ready;
    const settleCharts = () => {
      if (window.echarts?.getInstanceByDom) {
        for (const element of document.querySelectorAll("[_echarts_instance_]")) {
          const chart = window.echarts.getInstanceByDom(element);
          if (!chart) continue;
          chart.setOption({ animation: false }, false);
          chart.resize();
          chart.getZr?.().animation?.stop?.();
          chart.getZr?.().flush?.();
        }
      }
      const chartInstances = window.Chart?.instances;
      const charts = chartInstances instanceof Map
        ? [...chartInstances.values()]
        : Object.values(chartInstances || {});
      for (const chart of charts) {
        if (!chart) continue;
        chart.options.animation = false;
        chart.resize?.();
        chart.update?.("none");
      }
    };
    for (const delay of [0, 100, 300]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      settleCharts();
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
    }
    const initialHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight || 0
    );
    const step = Math.max(500, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < initialHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
    }
    window.scrollTo(0, 0);
    await Promise.all([...document.images].map(async (image) => {
      if (!image.complete) {
        await new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        });
      }
      if (image.decode) await image.decode().catch(() => undefined);
    }));

    const freezeChartImage = (target, dataUrl, width, height) => {
      if (!target || !dataUrl || width <= 0 || height <= 0) return false;
      const image = document.createElement("img");
      image.src = dataUrl;
      image.alt = target.getAttribute?.("aria-label") || "Chart";
      image.dataset.hsPdfChartSnapshot = "";
      image.dataset.hsPdfTop = String(
        target.getBoundingClientRect().top + window.scrollY
      );
      image.dataset.hsPdfHeight = String(height);
      image.style.cssText = [
        "display:block",
        "max-width:none",
        "object-fit:contain",
        "pointer-events:none",
        \`width:\${width}px\`,
        \`height:\${height}px\`
      ].join(";");
      target.replaceWith(image);
      return true;
    };
    if (window.echarts?.getInstanceByDom) {
      for (const element of [...document.querySelectorAll("[_echarts_instance_]")]) {
        const chart = window.echarts.getInstanceByDom(element);
        const rect = element.getBoundingClientRect();
        if (!chart || rect.width <= 0 || rect.height <= 0) continue;
        try {
          const dataUrl = chart.getDataURL({
            type: "png",
            pixelRatio: Math.max(1, window.devicePixelRatio || 1),
            backgroundColor: "transparent",
            excludeComponents: ["toolbox"]
          });
          const image = document.createElement("img");
          image.src = dataUrl;
          image.alt = element.getAttribute("aria-label") || "ECharts chart";
          image.dataset.hsPdfChartSnapshot = "";
          image.dataset.hsPdfTop = String(rect.top + window.scrollY);
          image.dataset.hsPdfHeight = String(rect.height);
          image.style.cssText = [
            "display:block",
            "width:100%",
            "height:100%",
            "max-width:none",
            "object-fit:contain",
            "pointer-events:none"
          ].join(";");
          element.replaceChildren(image);
        } catch {}
      }
    }
    for (const canvas of [...document.querySelectorAll("canvas")]) {
      if (canvas.closest("[data-hs-pdf-chart-snapshot]")) continue;
      const rect = canvas.getBoundingClientRect();
      try {
        freezeChartImage(
          canvas,
          canvas.toDataURL("image/png"),
          rect.width,
          rect.height
        );
      } catch {}
    }
    for (const element of document.querySelectorAll("*")) {
      const position = getComputedStyle(element).position;
      if (position !== "absolute" && position !== "fixed") continue;
      const rect = element.getBoundingClientRect();
      element.setAttribute("data-hs-pdf-layer", "");
      element.setAttribute(
        "data-hs-pdf-top",
        String(rect.top + window.scrollY)
      );
      element.setAttribute("data-hs-pdf-height", String(rect.height));
    }

    const viewportUnit = /(?:^|[^a-z])(vh|vw|vmin|vmax)(?:$|[^a-z])/i;
    const targets = new Map();
    const remember = (element, property) => {
      if (!element || !property || property.startsWith("--")) return;
      if (!targets.has(element)) targets.set(element, new Set());
      targets.get(element).add(property);
    };
    const visitRules = (rules) => {
      if (!rules) return;
      for (const rule of rules) {
        if (rule.type === CSSRule.MEDIA_RULE) {
          if (matchMedia(rule.conditionText).matches) visitRules(rule.cssRules);
          continue;
        }
        if (rule.type === CSSRule.SUPPORTS_RULE) {
          try {
            if (CSS.supports(rule.conditionText)) visitRules(rule.cssRules);
          } catch {
            visitRules(rule.cssRules);
          }
          continue;
        }
        if (rule.type === CSSRule.STYLE_RULE) {
          const properties = [...rule.style].filter((property) =>
            viewportUnit.test(rule.style.getPropertyValue(property))
          );
          if (!properties.length) continue;
          try {
            for (const element of document.querySelectorAll(rule.selectorText)) {
              for (const property of properties) remember(element, property);
            }
          } catch {}
          continue;
        }
        if (rule.cssRules) visitRules(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      try { visitRules(sheet.cssRules); } catch {}
    }
    for (const element of document.querySelectorAll("[style]")) {
      for (const property of element.style) {
        if (viewportUnit.test(element.style.getPropertyValue(property))) {
          remember(element, property);
        }
      }
    }
    let frozen = 0;
    for (const [element, properties] of targets) {
      const computed = getComputedStyle(element);
      for (const property of properties) {
        const value = computed.getPropertyValue(property);
        if (!value) continue;
        element.style.setProperty(property, value, "important");
        frozen += 1;
      }
    }
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
    return frozen;
  })()`);
}

export async function measureDocument(
  webContents: WebContents,
  frozenViewportProperties: number
): Promise<DocumentMeasurement> {
  const measurement = await execute<Omit<
    DocumentMeasurement,
    "frozenViewportProperties"
  >>(webContents, `(function () {
    const root = document.documentElement;
    const body = document.body;
    const elements = [root, body, ...document.querySelectorAll("body *")]
      .filter(Boolean);
    let maxRight = 0;
    let maxBottom = 0;
    for (const element of elements) {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = element.getBoundingClientRect();
      if (!Number.isFinite(rect.right) || !Number.isFinite(rect.bottom)) continue;
      maxRight = Math.max(maxRight, rect.right + window.scrollX);
      maxBottom = Math.max(maxBottom, rect.bottom + window.scrollY);
    }
    return {
      width: Math.ceil(Math.max(root.scrollWidth, body?.scrollWidth || 0, maxRight)),
      height: Math.ceil(Math.max(root.scrollHeight, body?.scrollHeight || 0, maxBottom)),
      images: document.images.length,
      failedImages: [...document.images].filter(
        (image) => image.complete && image.naturalWidth === 0
      ).length
    };
  })()`);
  return { ...measurement, frozenViewportProperties };
}

export async function alignParallelSmartBlocks(
  webContents: WebContents,
  targetPageHeight: number
): Promise<number> {
  return execute<number>(webContents, `(async function (targetPageHeight) {
    const containerSelector =
      "[class*=grid], [class*=columns], [class*=cols], [class*=row]";
    let alignedGroups = 0;
    const visibleChildren = (element) => [...element.children].filter((child) => {
      const style = getComputedStyle(child);
      const rect = child.getBoundingClientRect();
      return (
        style.display !== "none"
        && style.visibility !== "hidden"
        && rect.width > 2
        && rect.height > 2
      );
    });
    const semanticKey = (element) => {
      const classes = String(element.className || "")
        .split(/\\s+/)
        .filter(Boolean)
        .sort()
        .join(".");
      return \`\${element.tagName}.\${classes}\`;
    };
    for (const container of document.querySelectorAll(containerSelector)) {
      const display = getComputedStyle(container).display;
      if (!["grid", "inline-grid", "flex", "inline-flex"].includes(display)) {
        continue;
      }
      const items = visibleChildren(container);
      if (items.length < 2 || items.length > 60) continue;
      const rows = [];
      for (const item of items) {
        const rect = item.getBoundingClientRect();
        let row = rows.find((entry) => Math.abs(entry.top - rect.top) <= 4);
        if (!row) {
          row = { top: rect.top, items: [] };
          rows.push(row);
        }
        row.items.push(item);
      }
      for (const row of rows) {
        if (row.items.length < 2) continue;
        const sequences = row.items.map(visibleChildren);
        const childCount = sequences[0].length;
        if (childCount < 2 || childCount > 12) continue;
        if (sequences.some((sequence) => sequence.length !== childCount)) continue;
        if (sequences.some((sequence) =>
          sequence.some((element, index) =>
            semanticKey(element) !== semanticKey(sequences[0][index])
          )
        )) continue;
        const rowHeight = Math.max(
          ...row.items.map((item) => item.getBoundingClientRect().height)
        );
        if (rowHeight <= targetPageHeight * 1.05) continue;
        for (let index = 0; index < childCount; index += 1) {
          const heights = sequences.map(
            (sequence) => sequence[index].getBoundingClientRect().height
          );
          const maximum = Math.ceil(Math.max(...heights));
          if (
            maximum <= 1
            || Math.max(...heights) - Math.min(...heights) < 2
          ) continue;
          for (const sequence of sequences) {
            sequence[index].style.setProperty(
              "min-height",
              \`\${maximum}px\`,
              "important"
            );
          }
          alignedGroups += 1;
        }
      }
    }
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
    return alignedGroups;
  })(${JSON.stringify(targetPageHeight)})`);
}

export async function collectPaginationHints(
  webContents: WebContents,
  targetPageHeight: number
): Promise<PaginationHints> {
  return execute<PaginationHints>(webContents, `(function (targetPageHeight) {
    const candidates = [];
    const protectedRanges = [];
    const explicitRanges = [];
    const rangeKeys = new Set();
    const visibleRect = (element) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      if (
        style.display === "none"
        || style.visibility === "hidden"
        || Number(style.opacity) === 0
      ) return null;
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return null;
      return {
        top: rect.top + window.scrollY,
        bottom: rect.bottom + window.scrollY,
        height: rect.height,
        width: rect.width
      };
    };
    const addCandidate = (y, kind, weight, label) => {
      if (Number.isFinite(y) && y > 1) candidates.push({ y, kind, weight, label });
    };
    const protectRange = (top, bottom, label) => {
      if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom - top <= 2) {
        return;
      }
      const key = \`\${Math.round(top)}:\${Math.round(bottom)}:\${label}\`;
      if (rangeKeys.has(key)) return;
      rangeKeys.add(key);
      protectedRanges.push({ top, bottom, label });
    };
    const protect = (element, label, force = false) => {
      const rect = visibleRect(element);
      if (!rect || (!force && rect.height > targetPageHeight * 1.35)) return;
      protectRange(rect.top, rect.bottom, label);
    };

    const explicitSelector = ".page, .print-page, [data-page]";
    const explicitElements = [...document.querySelectorAll(explicitSelector)]
      .filter((element) => {
        const rect = visibleRect(element);
        return rect && !element.parentElement?.closest(explicitSelector);
      });
    const parentCounts = new Map();
    let explicitCoverage = 0;
    for (const element of explicitElements) {
      const rect = visibleRect(element);
      if (!rect) continue;
      explicitRanges.push({ top: rect.top, bottom: rect.bottom, label: "page" });
      addCandidate(rect.top, "explicit", 1400, "Explicit page start");
      addCandidate(rect.bottom, "explicit", 1400, "Explicit page end");
      protectRange(rect.top, rect.bottom, "explicit page");
      explicitCoverage += rect.height;
      const parent = element.parentElement;
      parentCounts.set(parent, (parentCounts.get(parent) || 0) + 1);
    }
    const largestSiblingGroup = Math.max(0, ...parentCounts.values());
    const documentHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight || 0
    );

    for (const heading of document.querySelectorAll(
      "h1, h2, h3, h4, h5, h6, [role=heading]"
    )) {
      const rect = visibleRect(heading);
      if (!rect) continue;
      addCandidate(
        rect.top,
        heading.matches("h1, h2") ? "heading" : "block",
        heading.matches("h1, h2") ? 1100 : 650,
        "Heading"
      );
      const next = visibleRect(heading.nextElementSibling);
      protectRange(
        rect.top,
        next && next.top - rect.bottom < targetPageHeight * 0.08
          ? Math.min(next.bottom, rect.top + targetPageHeight * 0.68)
          : rect.bottom,
        "heading with following content"
      );
    }

    for (const element of document.querySelectorAll(
      "section, article, .panel, .card, .page-card, [class*=module], [class*=card], [class*=grid], [class*=row]"
    )) {
      const rect = visibleRect(element);
      if (!rect || element === document.body) continue;
      addCandidate(rect.top, "visual", 850, "Visual block start");
      addCandidate(rect.bottom, "visual", 850, "Visual block end");
      if (rect.height <= targetPageHeight * 1.5) {
        protect(element, "visual block", true);
      }
    }
    for (const row of document.querySelectorAll("tr")) {
      const rect = visibleRect(row);
      if (!rect) continue;
      addCandidate(rect.top, "table", 920, "Table row boundary");
      addCandidate(rect.bottom, "table", 920, "Table row boundary");
      protect(row, "table row", true);
    }
    for (const element of document.querySelectorAll(
      "img, svg, canvas, video, figure, table, pre, code, .chart, [class*=summary], [class*=conclusion], [class*=wordcloud]"
    )) {
      protect(element, "atomic visual content");
    }
    for (const element of document.querySelectorAll("body *")) {
      const rect = visibleRect(element);
      if (!rect) continue;
      const style = getComputedStyle(element);
      if (/avoid/i.test(\`\${style.breakInside} \${style.pageBreakInside}\`)) {
        protect(element, "author-protected content", true);
      }
      if (/page|always|left|right/i.test(style.breakBefore)) {
        addCandidate(rect.top, "explicit", 1500, "CSS break before");
      }
      if (/page|always|left|right/i.test(style.breakAfter)) {
        addCandidate(rect.bottom, "explicit", 1500, "CSS break after");
      }
    }
    return {
      candidates,
      protectedRanges,
      explicitRanges,
      hardExplicitPagination:
        explicitRanges.length >= 2
        && largestSiblingGroup >= 2
        && explicitCoverage / Math.max(1, documentHeight) >= 0.65
    };
  })(${JSON.stringify(targetPageHeight)})`);
}
