import { describe, expect, it } from "vitest";
import { injectChartOverrideBootstrap } from "./chart-override-bootstrap";

describe("injectChartOverrideBootstrap", () => {
  it("does not change documents without chart overrides", () => {
    const html = "<html><body><p>hello</p></body></html>";
    expect(injectChartOverrideBootstrap(html)).toBe(html);
  });

  it("adds the portable chart override runtime when needed", () => {
    const html =
      '<html><body><script type="application/json" data-hs-chart-manifest>{}</script></body></html>';
    const result = injectChartOverrideBootstrap(html);
    expect(result).toContain("data-hs-chart-runtime");
    expect(result).toContain("window.echarts");
    expect(result.indexOf("data-hs-chart-runtime")).toBeLessThan(
      result.indexOf("</body>")
    );
  });
});
