import { describe, expect, it } from "vitest";
import { planSmartCuts } from "./smart-pagination";

describe("planSmartCuts", () => {
  it("preserves explicit page boundaries", () => {
    const plan = planSmartCuts(1800, {
      candidates: [],
      protectedRanges: [],
      explicitRanges: [
        { top: 0, bottom: 900, label: "page" },
        { top: 900, bottom: 1800, label: "page" }
      ],
      hardExplicitPagination: true
    }, 900);
    expect(plan.strategy).toBe("explicit-pages");
    expect(plan.cuts).toEqual([0, 900, 1800]);
  });

  it("moves a cut away from protected content", () => {
    const plan = planSmartCuts(1900, {
      candidates: [
        { y: 820, kind: "heading", weight: 900, label: "heading" },
        { y: 900, kind: "block", weight: 700, label: "block" }
      ],
      protectedRanges: [{ top: 850, bottom: 1040, label: "card" }],
      explicitRanges: [],
      hardExplicitPagination: false
    }, 900);
    expect(plan.cuts[1]).toBe(820);
  });
});
