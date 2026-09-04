import { describe, expect, it } from "vitest";
import { scanImportCompatibility } from "./compatibility-scanner";

describe("scanImportCompatibility", () => {
  it("classifies a Tailwind runtime-generated report", () => {
    const report = scanImportCompatibility(`
      <html><head>
        <script src="https://cdn.tailwindcss.com"></script>
      </head><body>
        <div id="cards"></div>
        <script>cards.innerHTML = '<article>Card</article>'</script>
      </body></html>
    `);
    expect(report.mode).toBe("dynamic-report");
    expect(report.detectedDependencies).toContain("tailwind-browser");
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "DEPENDENCY_LOCAL_MAPPING" }),
      expect.objectContaining({ code: "RUNTIME_GENERATED_DOM" })
    ]));
  });

  it("blocks unknown remote scripts and recognizes advanced structures", () => {
    const report = scanImportCompatibility(`
      <base href="https://example.com/">
      <script src="https://example.com/app.js"></script>
      <iframe src="https://example.com"></iframe>
      <script>customElements.define('x-card', class extends HTMLElement {
        connectedCallback() { this.attachShadow({mode:'open'}) }
      })</script>
    `);
    expect(report.level).toBe("limited");
    expect(report.mode).toBe("web-app");
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "UNKNOWN_REMOTE_SCRIPT" }),
      expect.objectContaining({ code: "IFRAME" }),
      expect.objectContaining({ code: "SHADOW_DOM" }),
      expect.objectContaining({ code: "BASE_HREF" })
    ]));
  });

  it("recognizes Chart.js as a locally mapped dependency", () => {
    const report = scanImportCompatibility(`
      <html><head>
        <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
      </head><body><canvas id="chart"></canvas></body></html>
    `);
    expect(report.level).not.toBe("limited");
    expect(report.detectedDependencies).toContain("chartjs");
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "DEPENDENCY_LOCAL_MAPPING" })
    ]));
    expect(report.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "UNKNOWN_REMOTE_SCRIPT" })
    ]));
  });

  it("shows a license notice for locally mapped Highcharts", () => {
    const report = scanImportCompatibility(`
      <script src="https://code.highcharts.com/highcharts.js"></script>
    `);
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "HIGHCHARTS_LICENSE" })
    ]));
  });

  it("maps common scripts, component styles, and Google Fonts locally", () => {
    const report = scanImportCompatibility(`
      <html><head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
      </head><body></body></html>
    `);
    expect(report.detectedDependencies).toEqual(expect.arrayContaining([
      "bootstrap",
      "bundled-fonts",
      "gsap"
    ]));
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "DEPENDENCY_LOCAL_MAPPING" }),
      expect.objectContaining({ code: "BUNDLED_FONT_SUBSTITUTION" })
    ]));
    expect(report.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "UNSUPPORTED_KNOWN_SCRIPT" }),
      expect.objectContaining({ code: "UNKNOWN_REMOTE_SCRIPT" })
    ]));
  });
});
