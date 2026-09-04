import { describe, expect, it } from "vitest";
import { parseFieldSet, serializeFieldSet } from "./component-model";

describe("component field sets", () => {
  it("normalizes duplicates and ordering", () => {
    expect(serializeFieldSet(["title", "image", "title"])).toBe(
      '["image","title"]'
    );
  });

  it("recovers from malformed metadata", () => {
    expect([...parseFieldSet("{bad")]).toEqual([]);
  });
});

