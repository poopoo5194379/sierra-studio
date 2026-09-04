import { describe, expect, it } from "vitest";
import {
  createProjectFeatures,
  parseProjectFeatures
} from "./project-features";

describe("project features", () => {
  it("falls back when persisted data is invalid", () => {
    expect(parseProjectFeatures({
      version: 1,
      responsive: { version: 1, activeBreakpointId: "missing", breakpoints: [] }
    }).responsive.activeBreakpointId).toBe("desktop");
  });

  it("returns independent defaults", () => {
    const first = createProjectFeatures();
    const second = createProjectFeatures();
    first.theme.tokens[0]!.light = "#000000";
    first.watermarks.items.push({
      id: "watermark_test",
      name: "测试",
      source: "data:image/png;base64,AA==",
      enabled: true,
      anchor: "top-right",
      widthMm: 25,
      aspectRatio: 3,
      offsetXmm: 8,
      offsetYmm: 8,
      opacity: 0.3,
      rotation: 0,
      repeat: false,
      screen: true,
      print: true,
      pages: []
    });
    expect(second.theme.tokens[0]!.light).not.toBe("#000000");
    expect(second.watermarks.items).toHaveLength(0);
  });
});
