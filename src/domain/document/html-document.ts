import { parseHTML } from "linkedom";
import { HtmlStudioError } from "../../shared/errors";
import { newNodeId } from "../../shared/ids";
import type { CommandPayload, StyleDeclaration } from "../commands/schema";
import {
  SANDBOXED_SCRIPT_POLICY,
  type ImportedScriptPolicy
} from "./script-policy";
import {
  readChartManifest,
  writeChartManifest
} from "../charts/chart-manifest";

const EDITOR_ID_ATTRIBUTE = "data-hs-id";

function serializeDocument(document: Document): string {
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

function findNode(document: Document, nodeId: string): HTMLElement {
  const node = [...document.querySelectorAll<HTMLElement>(
    `[${EDITOR_ID_ATTRIBUTE}]`
  )].find((candidate) => candidate.getAttribute(EDITOR_ID_ATTRIBUTE) === nodeId);
  if (!node) {
    throw new HtmlStudioError(`Node ${nodeId} does not exist`, "NODE_NOT_FOUND");
  }
  return node;
}

function applyDeclarations(
  element: HTMLElement,
  declarations: StyleDeclaration[]
): void {
  for (const declaration of declarations) {
    if (!declaration.existed) {
      element.style.removeProperty(declaration.property);
      continue;
    }
    element.style.setProperty(
      declaration.property,
      declaration.value,
      declaration.priority
    );
  }
}

export function createSafeWorkingDocument(
  sourceHtml: string,
  scriptPolicy: ImportedScriptPolicy = SANDBOXED_SCRIPT_POLICY
): string {
  const { document } = parseHTML(sourceHtml);
  for (const meta of document.querySelectorAll("meta[http-equiv]")) {
    if (meta.getAttribute("http-equiv")?.toLowerCase() === "content-security-policy") {
      meta.remove();
    }
  }
  if (scriptPolicy.mode === "strip") {
    for (const script of document.querySelectorAll("script")) {
      script.remove();
    }
  } else {
    for (const script of document.querySelectorAll("script")) {
      script.setAttribute("data-hs-user-script", "");
    }
  }
  for (const element of document.querySelectorAll<HTMLElement>("*")) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.toLowerCase().startsWith("on")) {
        element.removeAttribute(attribute.name);
      }
      if (
        ["href", "src", "action", "formaction"].includes(attribute.name.toLowerCase())
        && attribute.value.trim().toLowerCase().startsWith("javascript:")
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  for (const element of document.body.querySelectorAll<HTMLElement>("*")) {
    if (!element.hasAttribute(EDITOR_ID_ATTRIBUTE)) {
      element.setAttribute(EDITOR_ID_ATTRIBUTE, newNodeId());
    }
  }
  // Don't tag <body> with data-hs-id — body would intercept pointer events
  // for every element in the document. The "root container" semantics are
  // handled by the .page / .page-inner conventions or the runtime's
  // hs-canvas-root fallback (see editor-runtime/image-placement.ts and
  // index.ts#insertBlock).
  return serializeDocument(document);
}

export function applyCommandToHtml(
  currentHtml: string,
  payload: CommandPayload
): string {
  const { document } = parseHTML(currentHtml);
  switch (payload.type) {
    case "styles.set":
      for (const change of payload.nodes) {
        applyDeclarations(findNode(document, change.nodeId), change.after);
      }
      break;
    case "text.set":
      findNode(document, payload.nodeId).textContent = payload.after;
      break;
    case "text.patchStyle":
      findNode(document, payload.nodeId).innerHTML = payload.after;
      break;
    case "attribute.set": {
      const node = findNode(document, payload.nodeId);
      if (payload.after === null) node.removeAttribute(payload.name);
      else node.setAttribute(payload.name, payload.after);
      break;
    }
    case "node.insert": {
      const parent = findNode(document, payload.parentId);
      const node = document.createElement(payload.node.tagName);
      node.setAttribute(EDITOR_ID_ATTRIBUTE, payload.node.id);
      for (const [name, value] of Object.entries(payload.node.attributes)) {
        node.setAttribute(name, value);
      }
      node.textContent = payload.node.text;
      const reference = parent.children.item(payload.index);
      if (reference) parent.insertBefore(node, reference);
      else parent.appendChild(node);
      break;
    }
    case "node.delete":
      findNode(document, payload.nodeId).remove();
      break;
    case "node.move": {
      const parent = findNode(document, payload.parentId);
      const node = findNode(document, payload.nodeId);
      if (node.parentElement !== parent) {
        throw new HtmlStudioError(
          `Node ${payload.nodeId} is not a child of ${payload.parentId}`,
          "INVALID_MOVE_PARENT"
        );
      }
      node.remove();
      const reference = parent.children.item(payload.afterIndex);
      if (reference) parent.insertBefore(node, reference);
      else parent.appendChild(node);
      break;
    }
    case "chart.patch":
      writeChartManifest(document, payload.chartKey, payload.after);
      break;
  }
  return serializeDocument(document);
}

export function stripEditorMetadata(workingHtml: string): string {
  const { document } = parseHTML(workingHtml);
  const referencedIds = new Set<string>();
  for (const key of Object.keys(readChartManifest(document))) {
    const node = key.match(/:node:([^:]+)$/)?.[1];
    const anchor = key.match(/:anchor:([^:]+):/)?.[1];
    if (node) referencedIds.add(node);
    if (anchor) referencedIds.add(anchor);
  }
  for (const element of document.querySelectorAll(`[${EDITOR_ID_ATTRIBUTE}]`)) {
    const editorId = element.getAttribute(EDITOR_ID_ATTRIBUTE);
    if (editorId && referencedIds.has(editorId)) {
      element.setAttribute("data-hs-chart-stable-id", editorId);
    }
    element.removeAttribute(EDITOR_ID_ATTRIBUTE);
  }
  for (const element of document.querySelectorAll("[data-hs-user-script]")) {
    element.removeAttribute("data-hs-user-script");
  }
  return serializeDocument(document);
}
