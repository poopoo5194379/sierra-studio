import { injectChartOverrideBootstrap } from "../../domain/document/chart-override-bootstrap";
import { insertBeforeLastClosingTag } from "../../domain/document/html-injection";
import { parseHTML } from "linkedom";
import {
  applyWatermarksToDocument,
  parseWatermarkSettings,
  type WatermarkSettings
} from "../../domain/watermarks/watermark-model";
import {
  detectRuntimeDependency,
  detectRuntimeStyle,
  RUNTIME_DEPENDENCIES,
  RUNTIME_DEPENDENCY_ORDER,
  RUNTIME_STYLES,
  type RuntimeDependencyId,
  type RuntimeStyleId
} from "../../domain/document/runtime-dependencies";

function prepareLocalRuntimeDependencies(sourceHtml: string): {
  html: string;
  scripts: string;
  styles: string;
} {
  const detected = new Set<RuntimeDependencyId>();
  const detectedStyles = new Set<RuntimeStyleId>(["bundled-fonts"]);
  const scriptPattern = /<script\b([^>]*)>\s*<\/script\s*>/gi;
  let html = sourceHtml.replace(
    scriptPattern,
    (tag, attributes: string) => {
      const srcMatch = attributes.match(
        /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
      );
      const source = srcMatch?.[1] ?? srcMatch?.[2] ?? srcMatch?.[3];
      if (!source || !/^https?:\/\//i.test(source)) return tag;
      const dependency = detectRuntimeDependency(source);
      if (!dependency) return tag;
      detected.add(dependency);
      return `<script data-hs-local-dependency="${dependency}" `
        + `data-hs-original-src="${source.replaceAll('"', "&quot;")}"></script>`;
    }
  );
  const linkPattern = /<link\b([^>]*?)\/?>/gi;
  html = html.replace(linkPattern, (tag, attributes: string) => {
    const hrefMatch = attributes.match(
      /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
    );
    const source = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3];
    if (!source || !/^https?:\/\//i.test(source)) return tag;
    const style = detectRuntimeStyle(source);
    if (!style) return tag;
    detectedStyles.add(style);
    return `<link data-hs-local-style="${style}" `
      + `data-hs-original-href="${source.replaceAll('"', "&quot;")}">`;
  });

  if (/\becharts\s*\.\s*init\s*\(/.test(sourceHtml)) {
    detected.add("echarts");
  }
  if (
    detected.has("echarts-wordcloud")
    || /\btype\s*:\s*["']wordCloud["']/.test(sourceHtml)
  ) {
    detected.add("echarts");
    detected.add("echarts-wordcloud");
  }
  if (
    detected.has("highcharts-more")
    || detected.has("highcharts-exporting")
    || detected.has("highcharts-export-data")
    || detected.has("highcharts-accessibility")
  ) {
    detected.add("highcharts");
  }
  if (detected.has("gsap-scroll-trigger")) detected.add("gsap");
  for (const styleId of ["bootstrap", "swiper", "aos"] as const) {
    if (detected.has(styleId)) detectedStyles.add(styleId);
  }

  const scripts = RUNTIME_DEPENDENCY_ORDER
    .filter((dependency) => detected.has(dependency))
    .map((dependency) =>
      `<script src="${RUNTIME_DEPENDENCIES[dependency].runtimeUrl}" `
      + `data-hs-runtime-dependency="${dependency}"></script>`
    )
    .join("");
  const styleOrder: RuntimeStyleId[] = [
    "bundled-fonts",
    "bootstrap",
    "font-awesome",
    "swiper",
    "aos"
  ];
  const styles = styleOrder
    .filter((style) => detectedStyles.has(style))
    .map((style) =>
      `<link rel="stylesheet" href="${RUNTIME_STYLES[style].runtimeUrl}" `
      + `data-hs-runtime-style="${style}">`
    )
    .join("");
  return { html, scripts, styles };
}

export function createEditorDocumentResponse(
  sourceHtml: string,
  runtimeUrl = "htmlstudio-runtime://bundle/editor-runtime.js"
): Response {
  const prepared = prepareLocalRuntimeDependencies(sourceHtml);
  const runtimeOrigin = new URL(runtimeUrl).origin;
  const editorCsp = [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' htmlstudio-project: htmlstudio-runtime:${
      runtimeOrigin === "null" ? "" : ` ${runtimeOrigin}`
    }`,
    "style-src 'unsafe-inline' htmlstudio-project: htmlstudio-runtime:",
    "img-src htmlstudio-project: data: blob:",
    "font-src htmlstudio-project: htmlstudio-runtime: data:",
    "media-src htmlstudio-project: data: blob:",
    "connect-src 'none'",
    "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join("; ");
  const securityHead =
    `<meta http-equiv="Content-Security-Policy" content="${editorCsp}">`;
  const runtimeScript =
    `<script type="module" src="${runtimeUrl}"></script>`;
  const withHead = /<head(?:\s[^>]*)?>/i.test(prepared.html)
    ? prepared.html.replace(
      /<head(?:\s[^>]*)?>/i,
      (head) =>
        `${head}${securityHead}${prepared.styles}${prepared.scripts}`
    )
    : `${securityHead}${prepared.styles}${prepared.scripts}${prepared.html}`;
  const document = insertBeforeLastClosingTag(
    withHead,
    "body",
    runtimeScript
  );
  return new Response(document, {
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

export function createPdfDocumentResponse(
  sourceHtml: string,
  watermarkSettings?: WatermarkSettings
): Response {
  let exportHtml = sourceHtml;
  if (watermarkSettings) {
    const settings = parseWatermarkSettings(watermarkSettings);
    const { document } = parseHTML(sourceHtml);
    applyWatermarksToDocument(document, {
      ...settings,
      // PPTX renders in screen media while PDF renders in print media. Export
      // visibility should consistently follow the user's print/export toggle.
      items: settings.items.map((item) => ({
        ...item,
        enabled: item.enabled && item.print,
        screen: true,
        print: true
      }))
    });
    exportHtml = document.toString();
  }
  const prepared = prepareLocalRuntimeDependencies(exportHtml);
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' htmlstudio-project: htmlstudio-runtime:",
    "style-src 'unsafe-inline' htmlstudio-project: htmlstudio-runtime:",
    "img-src htmlstudio-project: data: blob:",
    "font-src htmlstudio-project: htmlstudio-runtime: data:",
    "media-src htmlstudio-project: data: blob:",
    "connect-src 'none'",
    "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join("; ");
  const meta =
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  const withRuntime = injectChartOverrideBootstrap(prepared.html);
  const withDependencies = /<head(?:\s[^>]*)?>/i.test(withRuntime)
    ? withRuntime.replace(
      /<head(?:\s[^>]*)?>/i,
      (head) => `${head}${prepared.styles}${prepared.scripts}`
    )
    : `${prepared.styles}${prepared.scripts}${withRuntime}`;
  const document = /<head(?:\s[^>]*)?>/i.test(withDependencies)
    ? withDependencies.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${meta}`)
    : `${meta}${withDependencies}`;
  return new Response(document, {
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}
