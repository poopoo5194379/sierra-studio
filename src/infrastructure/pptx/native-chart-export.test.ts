import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import { describe, expect, it } from "vitest";
import {
  mergeNativeChartsIntoPptx,
  nativeChartExtractionScript,
  type NativeChartOverlay
} from "./native-chart-export";

async function emptyDeck(): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.addSlide().addText("SierraStudio", { x: 1, y: 1, w: 4, h: 1 });
  const output = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
}

function sampleChart(): NativeChartOverlay {
  return {
    slideIndex: 0,
    engine: "echarts",
    kind: "bar",
    x: 1,
    y: 1.5,
    w: 8,
    h: 4.5,
    title: "季度销售额",
    showLegend: true,
    legendPosition: "t",
    fontFace: "Microsoft YaHei",
    textColor: "27364B",
    backgroundColor: "FFFFFF",
    gridColor: "DCE3EC",
    chartColors: ["2563EB", "F97316"],
    showValues: true,
    horizontal: false,
    stacked: false,
    percentStacked: false,
    series: [
      {
        name: "2025",
        type: "bar",
        labels: ["Q1", "Q2", "Q3", "Q4"],
        values: [12, 18, 24, 31],
        color: "2563EB"
      },
      {
        name: "2026",
        type: "bar",
        labels: ["Q1", "Q2", "Q3", "Q4"],
        values: [16, 22, 29, 38],
        color: "F97316"
      }
    ]
  };
}

describe("native PowerPoint chart export", () => {
  it("builds a self-contained extraction script", () => {
    const script = nativeChartExtractionScript(13.333, 7.5);
    expect(script).toContain("collectNativeChartOverlays");
    expect(script).toContain("13.333");
    expect(script).toContain("7.5");
  });

  it("merges a native chart and its workbook into an existing deck", async () => {
    const merged = await mergeNativeChartsIntoPptx(
      await emptyDeck(),
      [sampleChart()],
      1,
      13.333,
      7.5
    );
    const zip = await JSZip.loadAsync(merged);
    const slide = await zip.file("ppt/slides/slide1.xml")?.async("string");
    const relationships = await zip.file(
      "ppt/slides/_rels/slide1.xml.rels"
    )?.async("string");
    const contentTypes = await zip.file("[Content_Types].xml")?.async("string");

    expect(slide).toContain("<c:chart");
    expect(slide).toContain("原生图表");
    expect(relationships).toContain("relationships/chart");
    expect(zip.file("ppt/charts/chart1.xml")).not.toBeNull();
    expect(zip.file("ppt/charts/_rels/chart1.xml.rels")).not.toBeNull();
    expect(zip.file("ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx"))
      .not.toBeNull();
    expect(contentTypes).toContain("drawingml.chart+xml");
    expect(contentTypes).toContain('Extension="xlsx"');
  });
});
