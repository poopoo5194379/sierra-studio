import type { CommandPayload } from "../domain/commands/schema";
import { idOf, signatureOf } from "./dom";

export interface FlowDrag {
  mode: "flow";
  element: HTMLElement;
  parent: HTMLElement;
  beforeIndex: number;
  signature: string;
  lastTargetId: string | null;
  pointerEvents: string;
  opacity: string;
}

export function beginFlowDrag(
  element: HTMLElement,
  pointerId: number
): FlowDrag {
  const parent = element.parentElement;
  if (!parent) throw new Error("Flow component has no parent");
  const state: FlowDrag = {
    mode: "flow",
    element,
    parent,
    beforeIndex: [...parent.children].indexOf(element),
    signature: signatureOf(element),
    lastTargetId: null,
    pointerEvents: element.style.pointerEvents,
    opacity: element.style.opacity
  };
  element.setPointerCapture(pointerId);
  element.style.pointerEvents = "none";
  element.style.opacity = "0.45";
  return state;
}

export function updateFlowDrag(
  state: FlowDrag,
  clientX: number,
  clientY: number
): boolean {
  const candidates = [...state.parent.children].filter((candidate) =>
    candidate !== state.element && signatureOf(candidate) === state.signature
  );
  let target: Element | null = null;
  let distance = Infinity;
  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const candidateDistance = dx * dx + dy * dy;
    const withinExpandedBox = clientX >= rect.left - rect.width * 0.25
      && clientX <= rect.right + rect.width * 0.25
      && clientY >= rect.top - rect.height * 0.25
      && clientY <= rect.bottom + rect.height * 0.25;
    if (withinExpandedBox && candidateDistance < distance) {
      target = candidate;
      distance = candidateDistance;
    }
  }

  const targetId = idOf(target);
  if (!target || targetId === state.lastTargetId) return false;
  const children = [...state.parent.children];
  const elementIndex = children.indexOf(state.element);
  const targetIndex = children.indexOf(target);
  state.parent.insertBefore(
    state.element,
    elementIndex < targetIndex ? target.nextSibling : target
  );
  state.lastTargetId = targetId;
  return true;
}

export function finishFlowDrag(state: FlowDrag): CommandPayload | null {
  state.element.style.pointerEvents = state.pointerEvents;
  state.element.style.opacity = state.opacity;
  const afterIndex = [...state.parent.children].indexOf(state.element);
  if (afterIndex === state.beforeIndex) return null;
  return {
    type: "node.move",
    nodeId: idOf(state.element),
    parentId: idOf(state.parent),
    beforeIndex: state.beforeIndex,
    afterIndex
  };
}
