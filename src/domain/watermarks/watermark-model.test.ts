import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import {
  applyWatermarksToDocument,
  createWatermarkItem,
  createWatermarkSettings,
  readWatermarkSettings
} from "./watermark-model";

describe("document watermarks", () => {
  it("stores image data once and renders lightweight instances on every page", () => {
    const { document } = parseHTML(`
      <!doctype html><html><head></head><body>
        <section data-page-id="p1"></section>
        <section data-page-id="p2"></section>
        <section data-page-id="p3"></section>
      </body></html>
    `);
    const source = "data:image/png;base64,QUJDREVGRw==";
    const item = createWatermarkItem(source, 4, "公司 Logo");
    const settings = {
      ...createWatermarkSettings(),
      items: [item]
    };

    applyWatermarksToDocument(document, settings);

    expect(document.querySelectorAll("[data-hs-watermark-layer]")).toHaveLength(3);
    expect(document.querySelectorAll("[data-hs-watermark-id]")).toHaveLength(3);
    const style = document.querySelector("style[data-hs-watermark-style]");
    expect(style?.textContent?.split(source)).toHaveLength(2);
    expect(readWatermarkSettings(document)).toEqual(settings);
  });

  it("supports page scopes, multiple marks and legacy suppression", () => {
    const { document } = parseHTML(`
      <!doctype html><html><head></head><body>
        <section data-page-id="p1"><img class="company-watermark"></section>
        <section data-page-id="p2"><img class="company-watermark"></section>
        <section data-page-id="p3"><img class="company-watermark"></section>
      </body></html>
    `);
    const first = {
      ...createWatermarkItem("data:image/png;base64,QQ==", 2, "A"),
      pages: [1, 3]
    };
    const second = {
      ...createWatermarkItem("data:image/png;base64,Qg==", 1, "B"),
      anchor: "center" as const
    };
    applyWatermarksToDocument(document, {
      version: 1,
      items: [first, second],
      suppressedSelectors: [".company-watermark"]
    });

    const pages = [...document.querySelectorAll("[data-page-id]")];
    expect(pages[0]?.querySelectorAll("[data-hs-watermark-id]")).toHaveLength(2);
    expect(pages[1]?.querySelectorAll("[data-hs-watermark-id]")).toHaveLength(1);
    expect(pages[2]?.querySelectorAll("[data-hs-watermark-id]")).toHaveLength(2);
    expect(
      document.querySelector("style[data-hs-watermark-style]")?.textContent
    ).toContain(".company-watermark{display:none!important;}");
  });

  it("keeps repeated watermarks inside every page and isolates their size", () => {
    const { document } = parseHTML(`
      <!doctype html><html><head></head><body>
        <section data-page-id="p1"></section>
        <section data-page-id="p2"></section>
      </body></html>
    `);
    const item = {
      ...createWatermarkItem("data:image/png;base64,QQ==", 2, "Logo"),
      offsetXmm: -4,
      offsetYmm: -8
    };
    applyWatermarksToDocument(document, {
      ...createWatermarkSettings(),
      items: [item]
    });

    const stored = readWatermarkSettings(document);
    expect(stored?.items[0]?.offsetXmm).toBe(0);
    expect(stored?.items[0]?.offsetYmm).toBe(0);
    expect(document.querySelectorAll("[data-hs-watermark-id]")).toHaveLength(2);
    expect(
      document.querySelector("style[data-hs-watermark-style]")?.textContent
    ).toContain("height:auto!important");
  });

  it("allows suppressing a repeated pseudo-element logo without hiding its page", () => {
    const { document } = parseHTML(`
      <html><head></head><body><section class="slide"></section></body></html>
    `);
    applyWatermarksToDocument(document, {
      ...createWatermarkSettings(),
      suppressedSelectors: [".slide::after"]
    });
    expect(
      document.querySelector("style[data-hs-watermark-style]")?.textContent
    ).toContain(".slide::after{display:none!important;}");
  });
});
