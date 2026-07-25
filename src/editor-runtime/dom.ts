import type { StyleDeclaration } from "../domain/commands/schema";

const COMPONENT_TAGS = new Set(["DIV", "ARTICLE", "LI", "TR"]);

export const DYNAMIC_ID_PREFIX = "dyn_";

export function idOf(element: Element | null): string {
  return element?.getAttribute("data-hs-id") ?? "";
}

export function isDynamicId(nodeId: string): boolean {
  return nodeId.startsWith(DYNAMIC_ID_PREFIX);
}

export function isPersistentId(nodeId: string): boolean {
  return nodeId !== "" && !isDynamicId(nodeId);
}

/**
 * Nearest ancestor (or self) whose data-hs-id exists in the persisted
 * document, i.e. an id that was assigned at import time rather than a
 * runtime-only dynamic id.
 */
export function persistentAnchorOf(element: Element | null): HTMLElement | null {
  let current: Element | null = element;
  while (current) {
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
  return componentFor(target) ?? target?.closest<HTMLElement>("[data-hs-id]") ?? null;
}
