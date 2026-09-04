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
import { applyWatermarksToDocument } from "../watermarks/watermark-model";

const EDITOR_ID_ATTRIBUTE = "data-hs-id";
const ROOT_NODE_ID = "__hs_body__";
const TEXT_RUN_ATTRIBUTE = "data-hs-text-run";
const TEXT_RUN_BOUNDARIES = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "CANVAS", "DIV", "DL",
  "FIELDSET", "FIGURE", "FOOTER", "FORM", "HEADER", "HR", "IFRAME",
  "MAIN", "NAV", "OL", "SECTION", "TABLE", "UL", "VIDEO", "SCRIPT",
  "STYLE"
]);
const TEXT_RUN_CONTAINER_EXCLUSIONS = new Set([
  "HTML", "BODY", "SCRIPT", "STYLE", "SVG", "TABLE", "THEAD", "TBODY",
  "TFOOT", "TR", "UL", "OL", "SELECT", "OPTION"
]);

function serializeDocument(document: Document): string {
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

function findNode(document: Document, nodeId: string): HTMLElement {
  if (nodeId === ROOT_NODE_ID) return document.body;
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

function applyManagedStyle(
  document: Document,
  styleId: string,
  css: string | null
): void {
  const selector = `style[data-hs-managed-style="${styleId}"]`;
  const existing = document.querySelector<HTMLStyleElement>(selector);
  if (css === null) {
    existing?.remove();
    return;
  }
  const style = existing ?? document.createElement("style");
  style.setAttribute("data-hs-managed-style", styleId);
  style.textContent = css;
  if (!existing) (document.head ?? document.documentElement).appendChild(style);
}

/**
 * Structural cards sometimes mix block children with bare text:
 *   <div><div class="tag">...</div>quote <sup>...</sup></div>
 * Bare text has no selectable element, so wrap each meaningful inline run in
 * a neutral span before editor ids are assigned. This is semantic, id-agnostic
 * and keeps the exported visual layout unchanged.
 */
function wrapMixedTextRuns(document: Document): void {
  const containers = [document.body, ...document.body.querySelectorAll<HTMLElement>("*")];
  for (const container of containers) {
    if (TEXT_RUN_CONTAINER_EXCLUSIONS.has(container.tagName)) continue;
    const children = [...container.children];
    if (!children.some((child) => TEXT_RUN_BOUNDARIES.has(child.tagName))) {
      continue;
    }
    let run: ChildNode[] = [];
    const flush = (): void => {
      if (!run.some((node) =>
        node.nodeType === 3 && Boolean(node.textContent?.trim())
      )) {
        run = [];
        return;
      }
      const wrapper = document.createElement("span");
      wrapper.setAttribute(TEXT_RUN_ATTRIBUTE, "");
      container.insertBefore(wrapper, run[0] ?? null);
      for (const node of run) wrapper.appendChild(node);
      run = [];
    };
    for (const node of [...container.childNodes]) {
      if (
        node.nodeType === 1
        && TEXT_RUN_BOUNDARIES.has((node as Element).tagName)
      ) {
        flush();
        continue;
      }
      run.push(node);
    }
    flush();
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
  wrapMixedTextRuns(document);
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
      // Command v1 calls this field `text`, but it stores innerHTML. Using
      // textContent here would escape nested elements during paste and undo.
      node.innerHTML = payload.node.text;
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
    case "document.patch":
      for (const change of payload.attributes) {
        const node = findNode(document, change.nodeId);
        if (change.after === null) node.removeAttribute(change.name);
        else node.setAttribute(change.name, change.after);
      }
      for (const change of payload.managedStyles) {
        applyManagedStyle(document, change.styleId, change.after);
      }
      break;
    case "component.update":
      for (const change of payload.texts) {
        findNode(document, change.nodeId).textContent = change.after;
      }
      for (const change of payload.html) {
        findNode(document, change.nodeId).innerHTML = change.after;
      }
      for (const change of payload.styles) {
        applyDeclarations(findNode(document, change.nodeId), change.after);
      }
      for (const change of payload.attributes) {
        const node = findNode(document, change.nodeId);
        if (change.after === null) node.removeAttribute(change.name);
        else node.setAttribute(change.name, change.after);
      }
      break;
    case "watermarks.set":
      applyWatermarksToDocument(document, payload.after);
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
    element.removeAttribute("data-hs-responsive-rules");
    element.removeAttribute(TEXT_RUN_ATTRIBUTE);
    for (const attribute of [...element.attributes]) {
      if (
        attribute.name.startsWith("data-hs-component-")
        || attribute.name === "data-hs-symbol"
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  for (const style of document.querySelectorAll("style[data-hs-managed-style]")) {
    style.removeAttribute("data-hs-managed-style");
  }
  for (const element of document.querySelectorAll("[data-hs-user-script]")) {
    element.removeAttribute("data-hs-user-script");
  }
  for (const element of document.querySelectorAll<HTMLElement>("[style]")) {
    element.style.removeProperty("--hs-free-origin");
    element.style.removeProperty("--hs-free-container-origin");
    if (!element.getAttribute("style")?.trim()) {
      element.removeAttribute("style");
    }
  }
  return serializeDocument(document);
}
