import type { CommandPayload } from "../domain/commands/schema";
import {
  explicitDeclaration,
  idOf,
  inlineDeclaration
} from "./dom";

export interface FreeDrag {
  mode: "free";
  elements: Array<{
    element: HTMLElement;
    left: number;
    top: number;
    beforeLeft: ReturnType<typeof inlineDeclaration>;
    beforeTop: ReturnType<typeof inlineDeclaration>;
  }>;
  startX: number;
  startY: number;
}

export function beginFreeDrag(
  elements: HTMLElement[],
  clientX: number,
  clientY: number,
  pointerId: number = 0
): FreeDrag {
  try { elements[0]?.setPointerCapture(pointerId); } catch { /* ignore */ }
  return {
    mode: "free",
    elements: elements.map((element) => {
      const rect = element.getBoundingClientRect();
      const parentRect = element.offsetParent?.getBoundingClientRect()
        ?? { left: 0, top: 0 };
      return {
        element,
        left: rect.left - parentRect.left,
        top: rect.top - parentRect.top,
        beforeLeft: inlineDeclaration(element, "left"),
        beforeTop: inlineDeclaration(element, "top")
      };
    }),
    startX: clientX,
    startY: clientY
  };
}

export function updateFreeDrag(
  state: FreeDrag,
  clientX: number,
  clientY: number
): void {
  for (const item of state.elements) {
    item.element.style.left = `${item.left + clientX - state.startX}px`;
    item.element.style.top = `${item.top + clientY - state.startY}px`;
  }
}

export function finishFreeDrag(state: FreeDrag): CommandPayload {
  return {
    type: "styles.set",
    nodes: state.elements.map((item) => ({
      nodeId: idOf(item.element),
      before: [item.beforeLeft, item.beforeTop],
      after: [
        explicitDeclaration("left", item.element.style.left),
        explicitDeclaration("top", item.element.style.top)
      ]
    }))
  };
}
