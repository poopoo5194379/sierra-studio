const DEFAULT_EAST_ASIAN_FONT = "Microsoft YaHei";

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * dom-to-pptx serializes only the first CSS font family. For mixed Latin/CJK
 * text that commonly leaves every run tagged as Aptos, so Office chooses an
 * arbitrary Chinese fallback and changes both glyphs and line wrapping.
 *
 * Add an explicit DrawingML East Asian typeface to every text property block
 * while preserving the converter's Latin face.
 */
export function ensurePowerPointEastAsianFont(
  xml: string,
  fontFamily = DEFAULT_EAST_ASIAN_FONT
): string {
  const typeface = escapeXmlAttribute(fontFamily);
  const normalizeBody = (body: string): string => {
    if (/<a:ea\b[^>]*\/>/.test(body)) {
      return body.replace(
        /<a:ea\b([^>]*)\btypeface="[^"]*"([^>]*)\/>/g,
        `<a:ea$1typeface="${typeface}"$2/>`
      );
    }
    const latin = /<a:latin\b[^>]*\/>/;
    return latin.test(body)
      ? body.replace(latin, (tag) => `${tag}<a:ea typeface="${typeface}"/>`)
      : `<a:ea typeface="${typeface}"/>${body}`;
  };

  let output = xml.replace(
    /<a:(rPr|defRPr|endParaRPr)\b([^>]*)>([\s\S]*?)<\/a:\1>/g,
    (_block, tagName: string, attributes: string, body: string) =>
      `<a:${tagName}${attributes}>${normalizeBody(body)}</a:${tagName}>`
  );

  output = output.replace(
    /<a:(rPr|defRPr|endParaRPr)\b([^>]*)\/>/g,
    (_block, tagName: string, attributes: string) =>
      `<a:${tagName}${attributes}><a:ea typeface="${typeface}"/></a:${tagName}>`
  );
  return output;
}

