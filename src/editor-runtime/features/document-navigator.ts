import type {
  DocumentElementFilter,
  DocumentNavigationResult,
  DocumentOutlineItem,
  DocumentSearchResult
} from "../../domain/navigation/document-navigation";

const MAX_INDEXED_ELEMENTS = 20_000;
const MAX_RESULTS = 100;
const MAX_OUTLINE = 250;

function matchesFilter(
  element: HTMLElement,
  filter: DocumentElementFilter
): boolean {
  if (filter === "all") return true;
  if (filter === "image") return element.tagName === "IMG";
  if (filter === "chart") {
    return element.hasAttribute("data-hs-chart")
      || element.matches("canvas, svg")
      || Boolean(element.closest("[_echarts_instance_]"));
  }
  if (filter === "link") return element.tagName === "A";
  return !element.matches(
    "img, video, canvas, svg, script, style, link, meta"
  ) && Boolean(element.textContent?.trim());
}

export class DocumentNavigator {
  search(
    query: string,
    filter: DocumentElementFilter
  ): DocumentNavigationResult {
    const normalized = query.trim().toLocaleLowerCase();
    const all = [
      ...document.body.querySelectorAll<HTMLElement>("[data-hs-id]")
    ];
    const indexed = all.slice(0, MAX_INDEXED_ELEMENTS);
    const results: DocumentSearchResult[] = [];
    const outline: DocumentOutlineItem[] = [];
    for (const element of indexed) {
      const nodeId = element.dataset.hsId;
      if (!nodeId) continue;
      if (
        outline.length < MAX_OUTLINE
        && /^H[1-6]$/.test(element.tagName)
      ) {
        outline.push({
          nodeId,
          level: Number(element.tagName.slice(1)),
          text: element.textContent?.trim().slice(0, 120)
            || `未命名 ${element.tagName}`
        });
      }
      if (results.length >= MAX_RESULTS || !matchesFilter(element, filter)) {
        continue;
      }
      const text = element.textContent?.replace(/\s+/g, " ").trim()
        .slice(0, 160) ?? "";
      const className = element.className;
      const haystack = [
        text,
        element.tagName,
        nodeId,
        typeof className === "string" ? className : "",
        element.id
      ].join(" ").toLocaleLowerCase();
      if (normalized && !haystack.includes(normalized)) continue;
      results.push({
        nodeId,
        tag: element.tagName.toLowerCase(),
        text,
        className: typeof className === "string" ? className.slice(0, 120) : ""
      });
    }
    return {
      query,
      filter,
      results,
      outline,
      totalIndexed: indexed.length,
      truncated: all.length > indexed.length
    };
  }
}
