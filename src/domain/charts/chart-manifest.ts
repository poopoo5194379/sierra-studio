import type {
  ChartOverrideManifest,
  ChartPatch
} from "./chart-types";

export const CHART_MANIFEST_ATTRIBUTE = "data-hs-chart-manifest";

function parseManifest(value: string | null | undefined): ChartOverrideManifest {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as ChartOverrideManifest;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function readChartManifest(document: Document): ChartOverrideManifest {
  return parseManifest(
    document.querySelector<HTMLScriptElement>(
      `script[${CHART_MANIFEST_ATTRIBUTE}]`
    )?.textContent
  );
}

export function writeChartManifest(
  document: Document,
  chartKey: string,
  patch: ChartPatch
): void {
  const manifest = readChartManifest(document);
  manifest[chartKey] = patch;
  let element = document.querySelector<HTMLScriptElement>(
    `script[${CHART_MANIFEST_ATTRIBUTE}]`
  );
  if (!element) {
    element = document.createElement("script");
    element.type = "application/json";
    element.setAttribute(CHART_MANIFEST_ATTRIBUTE, "");
    (document.body ?? document.documentElement).appendChild(element);
  }
  element.textContent = JSON.stringify(manifest).replaceAll("<", "\\u003c");
}
