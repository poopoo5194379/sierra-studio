import type { CommandPayload } from "../domain/commands/schema";
import { persistedIdOf } from "./dom";

export interface ImagePlacement {
  element: HTMLImageElement;
  command: CommandPayload;
}

/**
 * GrapesJS-style: never attach data-hs-id to <body> or <html>.
 * Body is addressed through a reserved command id and remains unselectable.
 */
function getOrCreateInsertionContainer(): HTMLElement {
  // 1. .page-inner inside .page (project convention)
  const pageInner = document.querySelector<HTMLElement>(".page .page-inner");
  if (pageInner) return pageInner;
  // 2. Any existing .page
  const page = document.querySelector<HTMLElement>(".page");
  if (page) return page;
  // 3. Body has a reserved persistent command id.
  return document.body;
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
  let parentId = persistedIdOf(parent);
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
