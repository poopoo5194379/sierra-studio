export type RuntimeDependencyId =
  | "echarts"
  | "echarts-wordcloud"
  | "chartjs"
  | "bootstrap"
  | "d3"
  | "highcharts"
  | "highcharts-more"
  | "highcharts-exporting"
  | "highcharts-export-data"
  | "highcharts-accessibility"
  | "plotly"
  | "mermaid"
  | "gsap"
  | "gsap-scroll-trigger"
  | "three"
  | "animejs"
  | "alpinejs"
  | "swiper"
  | "aos"
  | "tailwind-browser";

export type RuntimeStyleId =
  | "bundled-fonts"
  | "bootstrap"
  | "font-awesome"
  | "swiper"
  | "aos";

export interface RuntimeDependency {
  id: RuntimeDependencyId;
  runtimeUrl: string;
}

export interface RuntimeStyle {
  id: RuntimeStyleId;
  runtimeUrl: string;
}

function vendorUrl(fileName: string): string {
  return `htmlstudio-runtime://bundle/vendor/${fileName}`;
}

export const RUNTIME_DEPENDENCIES: Record<
  RuntimeDependencyId,
  RuntimeDependency
> = {
  echarts: { id: "echarts", runtimeUrl: vendorUrl("echarts.min.js") },
  "echarts-wordcloud": {
    id: "echarts-wordcloud",
    runtimeUrl: vendorUrl("echarts-wordcloud.min.js")
  },
  chartjs: { id: "chartjs", runtimeUrl: vendorUrl("chart.umd.min.js") },
  bootstrap: {
    id: "bootstrap",
    runtimeUrl: vendorUrl("bootstrap.bundle.min.js")
  },
  d3: { id: "d3", runtimeUrl: vendorUrl("d3.min.js") },
  highcharts: {
    id: "highcharts",
    runtimeUrl: vendorUrl("highcharts.min.js")
  },
  "highcharts-more": {
    id: "highcharts-more",
    runtimeUrl: vendorUrl("highcharts-more.min.js")
  },
  "highcharts-exporting": {
    id: "highcharts-exporting",
    runtimeUrl: vendorUrl("highcharts-exporting.min.js")
  },
  "highcharts-export-data": {
    id: "highcharts-export-data",
    runtimeUrl: vendorUrl("highcharts-export-data.min.js")
  },
  "highcharts-accessibility": {
    id: "highcharts-accessibility",
    runtimeUrl: vendorUrl("highcharts-accessibility.min.js")
  },
  plotly: { id: "plotly", runtimeUrl: vendorUrl("plotly.min.js") },
  mermaid: { id: "mermaid", runtimeUrl: vendorUrl("mermaid.min.js") },
  gsap: { id: "gsap", runtimeUrl: vendorUrl("gsap.min.js") },
  "gsap-scroll-trigger": {
    id: "gsap-scroll-trigger",
    runtimeUrl: vendorUrl("ScrollTrigger.min.js")
  },
  three: { id: "three", runtimeUrl: vendorUrl("three.min.js") },
  animejs: { id: "animejs", runtimeUrl: vendorUrl("anime.min.js") },
  alpinejs: { id: "alpinejs", runtimeUrl: vendorUrl("alpine.min.js") },
  swiper: {
    id: "swiper",
    runtimeUrl: vendorUrl("swiper-bundle.min.js")
  },
  aos: { id: "aos", runtimeUrl: vendorUrl("aos.min.js") },
  "tailwind-browser": {
    id: "tailwind-browser",
    runtimeUrl: vendorUrl("tailwind-browser.js")
  }
};

export const RUNTIME_DEPENDENCY_ORDER: RuntimeDependencyId[] = [
  "echarts",
  "echarts-wordcloud",
  "chartjs",
  "bootstrap",
  "d3",
  "highcharts",
  "highcharts-more",
  "highcharts-exporting",
  "highcharts-export-data",
  "highcharts-accessibility",
  "plotly",
  "mermaid",
  "gsap",
  "gsap-scroll-trigger",
  "three",
  "animejs",
  "alpinejs",
  "swiper",
  "aos",
  "tailwind-browser"
];

export const RUNTIME_STYLES: Record<RuntimeStyleId, RuntimeStyle> = {
  "bundled-fonts": {
    id: "bundled-fonts",
    runtimeUrl: vendorUrl("fonts.css")
  },
  bootstrap: {
    id: "bootstrap",
    runtimeUrl: vendorUrl("bootstrap.min.css")
  },
  "font-awesome": {
    id: "font-awesome",
    runtimeUrl: vendorUrl("fontawesome.min.css")
  },
  swiper: {
    id: "swiper",
    runtimeUrl: vendorUrl("swiper-bundle.min.css")
  },
  aos: {
    id: "aos",
    runtimeUrl: vendorUrl("aos.min.css")
  }
};

function parseRemoteUrl(source: string): URL | null {
  try {
    return new URL(source);
  } catch {
    return null;
  }
}

export function detectRuntimeDependency(
  source: string
): RuntimeDependencyId | null {
  const parsed = parseRemoteUrl(source);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  const fileName = pathname.split("/").pop() ?? "";

  if (
    host === "cdn.tailwindcss.com"
    || (
      (host === "cdn.jsdelivr.net" || host === "unpkg.com")
      && pathname.includes("@tailwindcss/browser")
    )
  ) {
    return "tailwind-browser";
  }
  if (/echarts-wordcloud(?:\.min)?\.js$/.test(fileName)) {
    return "echarts-wordcloud";
  }
  if (/^echarts(?:\.min)?\.js$/.test(fileName)) return "echarts";
  if (/^chart(?:\.umd)?(?:\.min)?\.js$/.test(fileName)) return "chartjs";
  if (/^bootstrap(?:\.bundle)?(?:\.min)?\.js$/.test(fileName)) {
    return "bootstrap";
  }
  if (/^d3(?:\.v\d+)?(?:\.min)?\.js$/.test(fileName)) return "d3";

  if (/^highcharts-more(?:\.min)?\.js$/.test(fileName)) {
    return "highcharts-more";
  }
  if (/^exporting(?:\.min)?\.js$/.test(fileName)) {
    return "highcharts-exporting";
  }
  if (/^export-data(?:\.min)?\.js$/.test(fileName)) {
    return "highcharts-export-data";
  }
  if (/^accessibility(?:\.min)?\.js$/.test(fileName)) {
    return "highcharts-accessibility";
  }
  if (/^highcharts(?:\.min)?\.js$/.test(fileName)) return "highcharts";

  if (/^plotly(?:-\d+(?:\.\d+)*)?(?:\.min)?\.js$/.test(fileName)) {
    return "plotly";
  }
  if (/^mermaid(?:\.min)?\.js$/.test(fileName)) return "mermaid";
  if (/^scrolltrigger(?:\.min)?\.js$/.test(fileName)) {
    return "gsap-scroll-trigger";
  }
  if (/^gsap(?:\.min)?\.js$/.test(fileName) || pathname.includes("greensock")) {
    return "gsap";
  }
  if (/^three(?:\.min)?\.js$/.test(fileName)) return "three";
  if (/^anime(?:\.min)?\.js$/.test(fileName)) return "animejs";
  if (/^(?:cdn|alpine)(?:\.min)?\.js$/.test(fileName)
    && pathname.includes("alpine")) {
    return "alpinejs";
  }
  if (/^swiper(?:-bundle)?(?:\.min)?\.js$/.test(fileName)) return "swiper";
  if (/^aos(?:\.min)?\.js$/.test(fileName)) return "aos";
  return null;
}

export function detectRuntimeStyle(source: string): RuntimeStyleId | null {
  const parsed = parseRemoteUrl(source);
  if (!parsed) return null;
  const pathname = parsed.pathname.toLowerCase();
  const fileName = pathname.split("/").pop() ?? "";
  if (parsed.hostname.toLowerCase() === "fonts.googleapis.com") {
    return "bundled-fonts";
  }
  if (/^bootstrap(?:\.min)?\.css$/.test(fileName)) return "bootstrap";
  if (
    /^(?:all|fontawesome|brands|regular|solid)(?:\.min)?\.css$/.test(fileName)
    && /font-?awesome|@fortawesome/.test(
      `${parsed.hostname}${pathname}`.toLowerCase()
    )
  ) {
    return "font-awesome";
  }
  if (/^swiper(?:-bundle)?(?:\.min)?\.css$/.test(fileName)) return "swiper";
  if (/^aos(?:\.min)?\.css$/.test(fileName)) return "aos";
  return null;
}

export function detectKnownExternalDependency(source: string): string | null {
  const parsed = parseRemoteUrl(source);
  if (!parsed) return null;
  const runtimeDependency = detectRuntimeDependency(source);
  if (runtimeDependency) return runtimeDependency;
  const runtimeStyle = detectRuntimeStyle(source);
  if (runtimeStyle) return runtimeStyle;
  const value = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  if (/font-?awesome|@fortawesome/.test(value)) return "font-awesome";
  if (/bootstrap/.test(value)) return "bootstrap";
  if (/highcharts/.test(value)) return "highcharts";
  if (/plotly/.test(value)) return "plotly";
  if (/mermaid/.test(value)) return "mermaid";
  if (/gsap|greensock/.test(value)) return "gsap";
  if (/three/.test(value)) return "three";
  if (/anime/.test(value)) return "animejs";
  if (/alpine/.test(value)) return "alpinejs";
  if (/swiper/.test(value)) return "swiper";
  if (/aos/.test(value)) return "aos";
  return null;
}
