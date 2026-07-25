export function insertBeforeLastClosingTag(
  sourceHtml: string,
  tagName: string,
  insertion: string
): string {
  const closingTag = `</${tagName.toLowerCase()}>`;
  const index = sourceHtml.toLowerCase().lastIndexOf(closingTag);
  if (index < 0) return `${sourceHtml}${insertion}`;
  return `${sourceHtml.slice(0, index)}${insertion}${sourceHtml.slice(index)}`;
}
