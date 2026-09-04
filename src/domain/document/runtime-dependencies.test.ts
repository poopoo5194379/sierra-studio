import { describe, expect, it } from "vitest";
import {
  detectRuntimeDependency,
  detectRuntimeStyle
} from "./runtime-dependencies";

describe("runtime dependency detection", () => {
  it.each([
    ["https://cdn.jsdelivr.net/npm/bootstrap@5/dist/js/bootstrap.bundle.min.js", "bootstrap"],
    ["https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js", "d3"],
    ["https://code.highcharts.com/highcharts.js", "highcharts"],
    ["https://code.highcharts.com/highcharts-more.js", "highcharts-more"],
    ["https://code.highcharts.com/modules/exporting.js", "highcharts-exporting"],
    ["https://cdn.plot.ly/plotly-3.7.0.min.js", "plotly"],
    ["https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js", "mermaid"],
    ["https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js", "gsap"],
    ["https://cdn.jsdelivr.net/npm/gsap@3/dist/ScrollTrigger.min.js", "gsap-scroll-trigger"],
    ["https://cdnjs.cloudflare.com/ajax/libs/three.js/r160/three.min.js", "three"],
    ["https://cdn.jsdelivr.net/npm/animejs@3/lib/anime.min.js", "animejs"],
    ["https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js", "alpinejs"],
    ["https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js", "swiper"],
    ["https://unpkg.com/aos@2/dist/aos.js", "aos"]
  ])("maps %s to %s", (source, dependency) => {
    expect(detectRuntimeDependency(source)).toBe(dependency);
  });

  it.each([
    ["https://fonts.googleapis.com/css2?family=Inter", "bundled-fonts"],
    ["https://cdn.jsdelivr.net/npm/bootstrap@5/dist/css/bootstrap.min.css", "bootstrap"],
    ["https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css", "font-awesome"],
    ["https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css", "swiper"],
    ["https://unpkg.com/aos@2/dist/aos.css", "aos"]
  ])("maps stylesheet %s to %s", (source, style) => {
    expect(detectRuntimeStyle(source)).toBe(style);
  });
});
