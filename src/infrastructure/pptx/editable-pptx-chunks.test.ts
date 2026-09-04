import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import { describe, expect, it } from "vitest";
import { mergeEditablePptxChunks } from "./editable-pptx-chunks";

async function chunkWithText(text: string): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.addSlide().addText(text, { x: 1, y: 1, w: 6, h: 1 });
  const output = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
}

describe("mergeEditablePptxChunks", () => {
  it("keeps slide XML editable while joining chunks", async () => {
    const merged = await mergeEditablePptxChunks([
      await chunkWithText("第一批"),
      await chunkWithText("第二批"),
      await chunkWithText("第三批")
    ]);
    const zip = await JSZip.loadAsync(merged);
    const slides = Object.keys(zip.files).filter((name) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(name)
    );
    expect(slides).toHaveLength(3);
    await expect(zip.file("ppt/slides/slide1.xml")!.async("string"))
      .resolves.toContain("第一批");
    await expect(zip.file("ppt/slides/slide2.xml")!.async("string"))
      .resolves.toContain("第二批");
    await expect(zip.file("ppt/slides/slide3.xml")!.async("string"))
      .resolves.toContain("第三批");
    const presentation = await zip.file("ppt/presentation.xml")!.async("string");
    expect(presentation.match(/<p:sldId\b/g)).toHaveLength(3);
  });
});
