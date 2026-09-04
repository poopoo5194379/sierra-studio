import { describe, expect, it } from "vitest";
import {
  breakpointForViewport,
  createResponsiveSettings,
  rotateBreakpoint,
  validateBreakpoints
} from "./responsive-model";

describe("responsive project model", () => {
  it("selects the narrowest matching max-width breakpoint", () => {
    const settings = createResponsiveSettings();
    expect(breakpointForViewport(settings, 390).id).toBe("mobile");
    expect(breakpointForViewport(settings, 800).id).toBe("tablet");
    expect(breakpointForViewport(settings, 1440).id).toBe("desktop");
  });

  it("reports conflicting media ranges", () => {
    const settings = createResponsiveSettings();
    settings.breakpoints.push({
      id: "duplicate",
      name: "重复",
      width: 600,
      height: 800,
      direction: "max-width",
      mediaWidth: 767
    });
    expect(validateBreakpoints(settings.breakpoints)).toContain(
      "断点“重复”与其他断点的媒体范围重复"
    );
  });

  it("rotates a device without changing its media rule", () => {
    const mobile = createResponsiveSettings().breakpoints[2]!;
    expect(rotateBreakpoint(mobile)).toMatchObject({
      width: 844,
      height: 390,
      mediaWidth: 767
    });
  });
});
