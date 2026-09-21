import { describe, expect, it } from "vitest";
import { normalizeTableCellMargins } from "./pptx-table-normalization";

describe("normalizeTableCellMargins", () => {
  it("restores zero and asymmetric padding without changing cell alignment", () => {
    const xml = '<a:tcPr marL="242711" marR="8171245" marT="242711" marB="4773302" anchor="b">';
    expect(normalizeTableCellMargins(xml, [[0, 177798, 0, 101599]]))
      .toBe('<a:tcPr marL="0" marR="177798" marT="0" marB="101599" anchor="b">');
  });
  it("uses row-major cell order and leaves unmatched cells alone", () => {
    expect(normalizeTableCellMargins('<a:tcPr><a:tcPr marL="99">', [[1, 2, 3, 4]]))
      .toBe('<a:tcPr marL="1" marR="2" marT="3" marB="4"><a:tcPr marL="99">');
  });
});
