import { describe, expect, it } from "vitest";
import {
  createEditorDocumentResponse,
  createPdfDocumentResponse
} from "./editor-document";
import {
  createWatermarkItem,
  createWatermarkSettings
} from "../../domain/watermarks/watermark-model";

describe("createEditorDocumentResponse", () => {
  it("injects the isolated runtime and blocks network access", async () => {
    const response = createEditorDocumentResponse(
      '<!doctype html><html><head><script>const x = "</body>"</script></head>'
      + "<body><p>hello</p></body></html>"
    );
    const html = await response.text();
    expect(html).toContain(
      "script-src 'unsafe-inline' 'unsafe-eval' htmlstudio-project: htmlstudio-runtime:"
    );
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain(
      '<script type="module" src="htmlstudio-runtime://bundle/editor-runtime.js"></script>'
    );
    expect(html).toContain('const x = "</body>"');
    expect(html).toContain(
      '<p>hello</p><script type="module" src="htmlstudio-runtime://bundle/editor-runtime.js"></script></body>'
    );
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("maps remote ECharts dependencies to local scripts before user code", async () => {
    const html = await createEditorDocumentResponse(
      '<html><head>'
      + '<script src="https://cdn.example.com/echarts/5.6.0/echarts.min.js"></script>'
      + '<script src="https://cdn.example.com/echarts-wordcloud/2.1.0/echarts-wordcloud.min.js"></script>'
      + '</head><body><div id="chart"></div>'
      + '<script>echarts.init(document.getElementById("chart")).setOption({'
      + 'series:[{type:"wordCloud",data:[]}]});</script></body></html>'
    ).text();

    const echartsRuntime = html.indexOf(
      'src="htmlstudio-runtime://bundle/vendor/echarts.min.js"'
    );
    const wordCloudRuntime = html.indexOf(
      'src="htmlstudio-runtime://bundle/vendor/echarts-wordcloud.min.js"'
    );
    const userInitialization = html.indexOf("echarts.init(");

    expect(echartsRuntime).toBeGreaterThan(-1);
    expect(wordCloudRuntime).toBeGreaterThan(echartsRuntime);
    expect(userInitialization).toBeGreaterThan(wordCloudRuntime);
    expect(html).not.toMatch(
      /<script[^>]*\ssrc="https:\/\/cdn\.example\.com\/echarts\/5\.6\.0\/echarts\.min\.js"/
    );
    expect(html).toContain(
      'data-hs-original-src="https://cdn.example.com/echarts/5.6.0/echarts.min.js"'
    );
  });

  it("does not rewrite unrelated remote scripts", async () => {
    const html = await createEditorDocumentResponse(
      '<html><head><script src="https://example.com/app.js"></script></head>'
      + "<body></body></html>"
    ).text();
    expect(html).toContain('src="https://example.com/app.js"');
    expect(html).not.toContain("/vendor/echarts.min.js");
  });

  it("maps Tailwind Play CDN to the bundled browser runtime", async () => {
    const html = await createEditorDocumentResponse(
      '<html><head><script src="https://cdn.tailwindcss.com"></script></head>'
      + '<body><div class="grid min-h-screen">Report</div></body></html>'
    ).text();

    expect(html).toContain(
      'src="htmlstudio-runtime://bundle/vendor/tailwind-browser.js"'
    );
    expect(html).toContain('data-hs-local-dependency="tailwind-browser"');
    expect(html).toContain(
      'data-hs-original-src="https://cdn.tailwindcss.com"'
    );
    expect(html).not.toMatch(
      /<script[^>]*\ssrc="https:\/\/cdn\.tailwindcss\.com"/
    );
  });

  it("maps remote Chart.js to the bundled UMD runtime before user code", async () => {
    const html = await createEditorDocumentResponse(
      '<html><head>'
      + '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>'
      + '</head><body><canvas id="chart"></canvas>'
      + '<script>new Chart(document.getElementById("chart"), {type:"bar"});</script>'
      + '</body></html>'
    ).text();

    const chartRuntime = html.indexOf(
      'src="htmlstudio-runtime://bundle/vendor/chart.umd.min.js"'
    );
    const userInitialization = html.indexOf("new Chart(");

    expect(chartRuntime).toBeGreaterThan(-1);
    expect(userInitialization).toBeGreaterThan(chartRuntime);
    expect(html).not.toMatch(
      /<script[^>]*\ssrc="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js@4\.4\.1\/dist\/chart\.umd\.min\.js"/
    );
    expect(html).toContain('data-hs-local-dependency="chartjs"');
    expect(html).toContain(
      'data-hs-original-src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"'
    );
  });

  it("maps common report libraries and their companion styles locally", async () => {
    const html = await createEditorDocumentResponse(
      '<html><head>'
      + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">'
      + '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5/dist/css/bootstrap.min.css">'
      + '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css">'
      + '<script src="https://cdn.jsdelivr.net/npm/bootstrap@5/dist/js/bootstrap.bundle.min.js"></script>'
      + '<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>'
      + '<script src="https://code.highcharts.com/highcharts.js"></script>'
      + '<script src="https://cdn.plot.ly/plotly-3.7.0.min.js"></script>'
      + '<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>'
      + '<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>'
      + '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r160/three.min.js"></script>'
      + '<script src="https://cdn.jsdelivr.net/npm/animejs@3/lib/anime.min.js"></script>'
      + '<script src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>'
      + '<script src="https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js"></script>'
      + '<script src="https://unpkg.com/aos@2/dist/aos.js"></script>'
      + '</head><body></body></html>'
    ).text();

    for (const dependency of [
      "bootstrap",
      "d3",
      "highcharts",
      "plotly",
      "mermaid",
      "gsap",
      "three",
      "animejs",
      "alpinejs",
      "swiper",
      "aos"
    ]) {
      expect(html).toContain(`data-hs-runtime-dependency="${dependency}"`);
    }
    for (const style of [
      "bundled-fonts",
      "bootstrap",
      "swiper",
      "aos"
    ]) {
      expect(html).toContain(`data-hs-runtime-style="${style}"`);
    }
    expect(html).not.toMatch(
      /<script[^>]*\ssrc="https?:\/\//
    );
    expect(html).not.toMatch(
      /<link[^>]*\shref="https?:\/\//
    );
  });

  it("allows sandboxed project scripts while omitting the editor runtime for PDF", async () => {
    const html = await createPdfDocumentResponse(
      "<html><head></head><body>report</body></html>"
    ).text();
    expect(html).toContain("style-src 'unsafe-inline' htmlstudio-project:");
    expect(html).not.toContain("editor-runtime.js");
    expect(html).toContain(
      "script-src 'unsafe-inline' 'unsafe-eval' htmlstudio-project: htmlstudio-runtime:"
    );
  });

  it("materializes saved global watermarks into an export document", async () => {
    const item = {
      ...createWatermarkItem("data:image/png;base64,QQ==", 3, "Logo"),
      screen: false,
      print: true
    };
    const html = await createPdfDocumentResponse(
      "<html><head></head><body><section class=\"slide\"></section>"
      + "<section class=\"slide\"></section></body></html>",
      { ...createWatermarkSettings(), items: [item] }
    ).text();
    expect(html.match(/<div[^>]*data-hs-watermark-layer/g)).toHaveLength(2);
    expect(html.match(/<span[^>]*data-hs-watermark-id=/g)).toHaveLength(2);
    expect(html).toContain("data-hs-watermark-manifest");
    expect(html).not.toContain("@media screen{[data-hs-watermark-id");
  });

  it("keeps Tailwind available when rendering a PDF", async () => {
    const html = await createPdfDocumentResponse(
      '<html><head><script src="https://cdn.tailwindcss.com"></script></head>'
      + '<body class="flex"></body></html>'
    ).text();
    expect(html).toContain(
      'src="htmlstudio-runtime://bundle/vendor/tailwind-browser.js"'
    );
  });

  it("keeps Chart.js available when rendering a PDF", async () => {
    const html = await createPdfDocumentResponse(
      '<html><head>'
      + '<script src="https://unpkg.com/chart.js/dist/chart.umd.js"></script>'
      + '</head><body><canvas id="chart"></canvas></body></html>'
    ).text();
    expect(html).toContain(
      'src="htmlstudio-runtime://bundle/vendor/chart.umd.min.js"'
    );
  });
});
