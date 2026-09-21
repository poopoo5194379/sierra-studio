/** Restore measured CSS padding in EMU; converter margins can be unit-corrupted. */
export function normalizeTableCellMargins(xml: string, cellMargins: number[][]): string {
  let cellIndex = 0;
  return xml.replace(/<a:tcPr\b([^>]*)>/g, (tag, attributes: string) => {
    const margins = cellMargins[cellIndex++];
    if (!margins || margins.length !== 4) return tag;
    let normalized = attributes;
    ["marL", "marR", "marT", "marB"].forEach((name, index) => {
      const value = Math.max(0, Math.round(margins[index] ?? 0));
      const pattern = new RegExp(`\\b${name}="[^"]*"`);
      normalized = pattern.test(normalized)
        ? normalized.replace(pattern, `${name}="${value}"`)
        : `${normalized} ${name}="${value}"`;
    });
    return `<a:tcPr${normalized}>`;
  });
}
