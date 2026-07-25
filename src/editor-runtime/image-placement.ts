import type { CommandPayload } from "../domain/commands/schema";
import { idOf } from "./dom";

export interface ImagePlacement {
  element: HTMLImageElement;
  command: CommandPayload;
}

const CANVAS_ROOT_ID = "hs-canvas-root";

/**
 * GrapesJS-style: never attach data-hs-id to <body> or <html>.
 * Instead create a dedicated insertion container if needed.
 * <body> being clickable as a SelectionOverlay host (0×0 invisible) is the
 * classic Electron-editor pitfall.
 */
function getOrCreateInsertionContainer(): HTMLElement {
  // 1. .page-inner inside .page (project convention)
  const pageInner = document.querySelector<HTMLElement>(".page .page-inner");
  if (pageInner) return pageInner;
  // 2. Any existing .page
  const page = document.querySelector<HTMLElement>(".page");
  if (page) return page;
  // 3. Reuse our own root if previously created
  const existing = document.getElementById(CANVAS_ROOT_ID);
  if (existing) return existing as HTMLElement;
  // 4. Create a dedicated editor container (NOT body/html)
  const root = document.createElement("div");
  root.id = CANVAS_ROOT_ID;
  root.dataset.hsId = `node_root_${Math.random().toString(36).slice(2, 10)}`;
  root.style.cssText = "min-height: 200px; padding: 16px; box-sizing: border-box;";
  // Append to the deepest meaningful container or body
  const host = document.querySelector<HTMLElement>("main, #app, .canvas, body")
    ?? document.body;
  host.appendChild(root);
  return root;
}

function getInsertionParent(target: Element): HTMLElement {
  // Find nearest ancestor that has data-hs-id, BUT skip body/html
  const withId = target.closest<HTMLElement>("[data-hs-id]:not(body):not(html)");
  if (withId) return withId;
  // Try .page-inner
  const pageInner = target.closest<HTMLElement>(".page .page-inner");
  if (pageInner) return pageInner;
  // Fall back to a dedicated root container
  return getOrCreateInsertionContainer();
}

export function placeImage(
  path: string,
  target: Element,
  _event: MouseEvent
): ImagePlacement {
  const parent = getInsertionParent(target);
  // Ensure the parent has an editor id (NOT body/html — handled above)
  let parentId = idOf(parent);
  if (!parentId) {
    parentId = `node_${crypto.randomUUID()}`;
    parent.dataset.hsId = parentId;
  }

  const nodeId = `node_${crypto.randomUUID()}`;
  const img = document.createElement("img");
  img.dataset.hsId = nodeId;
  img.src = path;
  img.alt = "插入的图片";
  img.draggable = false;

  // GrapesJS Asset style: visible "loading" state so the user sees a
  // placeholder immediately, not an invisible 0×0 element.
  Object.assign(img.style, {
    display: "block",
    width: "200px",
    minWidth: "80px",
    minHeight: "40px",
    height: "auto",
    maxWidth: "100%",
    margin: "12px 0",
    border: "1px dashed #4f7cff",
    background: "#f0f4ff",
    objectFit: "contain"
  });

  img.addEventListener("load", () => {
    img.style.width = "";
    img.style.minWidth = "";
    img.style.minHeight = "";
    img.style.border = "";
    img.style.background = "";
    img.style.objectFit = "";
  }, { once: true });

  img.addEventListener("error", () => {
    img.style.border = "2px solid #e74c3c";
    img.style.background = "#fff0f0";
    img.style.padding = "8px";
    img.alt = "⚠ 图片加载失败";
    console.error("[SierraStudio] Failed to load image:", path);
  }, { once: true });

  parent.appendChild(img);
  const index = [...parent.children].indexOf(img);

  return {
    element: img,
    command: {
      type: "node.insert",
      parentId,
      index: index >= 0 ? index : parent.children.length - 1,
      node: {
        id: nodeId,
        tagName: "img",
        attributes: {
          src: path,
          alt: "插入的图片",
          style: img.getAttribute("style") ?? ""
        },
        text: ""
      }
    }
  };
}
