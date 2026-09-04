import type { StyleDeclaration } from "../domain/commands/schema";

const COMPONENT_TAGS = new Set(["DIV", "ARTICLE", "LI", "TR"]);
const RICH_TEXT_TAGS = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "SPAN",
  "A",
  "LI",
  "BLOCKQUOTE",
  "LABEL",
  "BUTTON",
  "TD",
  "TH",
  "FIGCAPTION"
]);
const STRUCTURAL_CHILD_TAGS = [
  "address",
  "article",
  "aside",
  "blockquote",
  "canvas",
  "div",
  "dl",
  "fieldset",
  "figure",
  "footer",
  "form",
  "header",
  "hr",
  "iframe",
  "main",
  "nav",
  "ol",
  "section",
  "table",
  "ul",
  "video"
];
const STRUCTURAL_CHILD_SELECTOR = STRUCTURAL_CHILD_TAGS
  .map((tagName) => `:scope > ${tagName}`)
  .join(",");

export const DYNAMIC_ID_PREFIX = "dyn_";
export const ROOT_NODE_ID = "__hs_body__";

export function idOf(element: Element | null): string {
  return element?.getAttribute("data-hs-id") ?? "";
}

export function persistedIdOf(element: Element | null): string {
  return element === document.body ? ROOT_NODE_ID : idOf(element);
}

export function isDynamicId(nodeId: string): boolean {
  return nodeId.startsWith(DYNAMIC_ID_PREFIX);
}

export function isPersistentId(nodeId: string): boolean {
  return nodeId !== "" && !isDynamicId(nodeId);
}

/**
 * The inspector's plain-text field is intentionally limited to leaf nodes.
 * Assigning textContent to a layout container destroys all nested markup,
 * script mount points and editor IDs.
 */
export function canEditPlainText(element: HTMLElement): boolean {
  return !element.matches("body,html,script,style,img,video,canvas,iframe")
    && element.children.length === 0;
}

/**
 * Direct canvas editing may preserve inline markup, but must never start on
 * a structural container. The commit path stores innerHTML atomically.
 */
export function canEditRichText(element: HTMLElement): boolean {
  if (canEditPlainText(element)) return true;
  return RICH_TEXT_TAGS.has(element.tagName)
    && !element.querySelector(STRUCTURAL_CHILD_SELECTOR);
}

/**
 * Promote an inline click target (for example <strong> or <sup>) to the
 * surrounding paragraph/list cell that can safely preserve inline markup.
 */
export function richTextContainerFor(
  target: Element | null
): HTMLElement | null {
  let current = target?.closest<HTMLElement>("[data-hs-id]") ?? null;
  let best: HTMLElement | null = null;
  while (current && current !== document.body) {
    if (!canEditRichText(current)) {
      if (best) break;
      current = current.parentElement;
      continue;
    }
    best = current;
    current = current.parentElement;
  }
  return best;
}

/**
 * Nearest ancestor (or self) whose data-hs-id exists in the persisted
 * document, i.e. an id that was assigned at import time rather than a
 * runtime-only dynamic id.
 */
export function persistentAnchorOf(element: Element | null): HTMLElement | null {
  let current: Element | null = element;
  while (current) {
    if (current === document.body) return document.body;
    if (current instanceof HTMLElement && isPersistentId(idOf(current))) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/** Child-index path from anchor down to element, e.g. "2.0.4". */
export function pathBetween(anchor: Element, element: Element): string {
  const indexes: number[] = [];
  let current: Element | null = element;
  while (current && current !== anchor) {
    const parent: Element | null = current.parentElement;
    if (!parent) return "";
    indexes.unshift([...parent.children].indexOf(current));
    current = parent;
  }
  return current === anchor ? indexes.join(".") : "";
}

export function inlineDeclaration(
  element: HTMLElement,
  property: string
): StyleDeclaration {
  const value = element.style.getPropertyValue(property);
  return {
    property,
    value,
    priority: element.style.getPropertyPriority(property) === "important"
      ? "important"
      : "",
    existed: value !== ""
  };
}

export function explicitDeclaration(
  property: string,
  value: string,
  priority: "" | "important" = ""
): StyleDeclaration {
  return { property, value, priority, existed: true };
}

export function signatureOf(element: Element): string {
  return `${element.tagName}.${[...element.classList].sort().join(".")}`;
}

export function isRepeatedComponent(element: Element | null): boolean {
  if (
    !(element instanceof HTMLElement)
    || !element.parentElement
    || !COMPONENT_TAGS.has(element.tagName)
    || element.classList.contains("page")
  ) {
    return false;
  }
  const hasComponentSemantics = ["LI", "TR"].includes(element.tagName)
    || [...element.classList].some((className) =>
      /(card|item|tile|panel|block|board|kpi)/i.test(className)
    );
  if (!hasComponentSemantics) return false;

  const signature = signatureOf(element);
  return [...element.parentElement.children]
    .filter((sibling) => signatureOf(sibling) === signature)
    .length >= 2;
}

export function componentFor(target: Element | null): HTMLElement | null {
  let current = target?.closest<HTMLElement>("[data-hs-id]") ?? null;
  while (current && current !== document.body) {
    if (current.classList.contains("page")) break;
    if (isRepeatedComponent(current)) return current;
    current = current.parentElement;
  }
  return null;
}

export function selectionFor(target: Element | null): HTMLElement | null {
  const componentField = target?.closest<HTMLElement>(
    "[data-hs-component-field][data-hs-id]"
  ) ?? null;
  if (componentField) return componentField;
  return componentFor(target) ?? target?.closest<HTMLElement>("[data-hs-id]") ?? null;
}
