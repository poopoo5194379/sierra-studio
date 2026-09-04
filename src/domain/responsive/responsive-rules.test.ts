import { describe, expect, it } from "vitest";
import { createResponsiveSettings } from "./responsive-model";
import {
  parseResponsiveManifest,
  renderResponsiveCss,
  upsertResponsiveRule
} from "./responsive-rules";

describe("responsive rules", () => {
  it("upserts a property without deleting other breakpoint properties", () => {
    const mobile = createResponsiveSettings().breakpoints[2]!;
    let manifest = parseResponsiveManifest(null, "node_ABC");
    manifest = upsertResponsiveRule(manifest, mobile, [
      { property: "font-size", value: "20px" },
      { property: "display", value: "none" }
    ]);
    manifest = upsertResponsiveRule(manifest, mobile, [
      { property: "font-size", value: "18px" }
    ]);
    expect(manifest.rules[0]?.declarations).toEqual([
      { property: "font-size", value: "18px" },
      { property: "display", value: "none" }
    ]);
  });

  it("renders export-stable media CSS", () => {
    const mobile = createResponsiveSettings().breakpoints[2]!;
    const manifest = upsertResponsiveRule(
      parseResponsiveManifest(null, "node_ABC"),
      mobile,
      [{ property: "font-size", value: "18px" }]
    );
    expect(renderResponsiveCss([manifest])).toContain(
      "@media (max-width: 767px)"
    );
    expect(renderResponsiveCss([manifest])).toContain(
      ".hsr-node_abc"
    );
    expect(renderResponsiveCss([manifest])).toContain("18px !important");
  });
});

