import type { CommandPayload } from "../domain/commands/schema";
import {
  DYNAMIC_ID_PREFIX,
  idOf,
  isDynamicId,
  pathBetween,
  persistentAnchorOf
} from "./dom";
import { postToHost } from "./protocol";

/**
 * Elements created at runtime by the page's own scripts (ECharts containers,
 * innerHTML-generated cards, table rows, …) do not exist in the persisted
 * working document, so commands that reference them directly would fail with
 * NODE_NOT_FOUND in the main process.
 *
 * This manager makes those elements first-class editing citizens:
 *
 * 1. Every dynamic element gets a runtime-only `data-hs-id` with a `dyn_`
 *    prefix so selection, overlays and the properties panel work.
 * 2. Edits targeting dynamic elements are rewritten into an `attribute.set`
 *    command on the nearest *persistent* anchor: the anchor accumulates a
 *    JSON manifest (`data-hs-dyn-patches`) keyed by the child-index path from
 *    the anchor to the dynamic element. This keeps every change inside the
 *    normal command / SQLite pipeline and remains undoable.
 * 3. On startup and whenever the page scripts add new nodes, the manifests
 *    are replayed so edits survive reloads and re-imports.
 */

export const DYNAMIC_PATCH_ATTRIBUTE = "data-hs-dyn-patches";

interface DynamicStyleEntry {
  value: string;
  priority: "" | "important";
}

interface DynamicNodePatch {
  styles?: Record<string, DynamicStyleEntry>;
  text?: string;
  attrs?: Record<string, string | null>;
  html?: string;
}

type AnchorManifest = Record<string, DynamicNodePatch>;

const SKIPPED_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "META", "TEMPLATE"]);

export class DynamicNodeManager {
  private counter = 0;
  private observer: MutationObserver | null = null;
  private replayQueued = false;

  start(): void {
    this.assignIds(document.body);
    this.replayAll();
    this.observer = new MutationObserver((mutations) => {
      let touched = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) {
            this.assignIds(node);
            touched = true;
          }
        }
      }
      if (touched) this.scheduleReplay();
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
    for (const delay of [250, 1000, 2500]) {
      window.setTimeout(() => {
        this.assignIds(document.body);
        this.replayAll();
      }, delay);
    }
  }

  /**
   * Rewrites a runtime command so that it only references persistent nodes.
   * Returns the list of commands to actually submit (possibly empty).
   */
  convert(payload: CommandPayload): CommandPayload[] {
    switch (payload.type) {
      case "styles.set":
        return this.convertStyles(payload);
      case "text.set":
        return isDynamicId(payload.nodeId)
          ? this.patchCommandFor(payload.nodeId, { text: payload.after })
          : [payload];
      case "attribute.set":
        return isDynamicId(payload.nodeId)
          ? this.patchCommandFor(payload.nodeId, {
            attrs: { [payload.name]: payload.after }
          })
          : [payload];
      case "node.insert":
        if (isDynamicId(payload.parentId)) {
          postToHost({
            type: "notice",
            message: "该区域由页面脚本生成，请将图片插入静态区域"
          });
          return [];
        }
        return [payload];
      case "node.delete":
      case "node.move":
        if (isDynamicId(payload.nodeId) || isDynamicId(payload.parentId)) {
          postToHost({
            type: "notice",
            message: "脚本生成的对象暂不支持移动顺序或删除"
          });
          return [];
        }
        return [payload];
      case "chart.patch":
        return [payload];
      case "text.patchStyle":
        return isDynamicId(payload.nodeId)
          ? this.patchCommandFor(payload.nodeId, { html: payload.after })
          : [payload];
    }
  }

  private convertStyles(
    payload: Extract<CommandPayload, { type: "styles.set" }>
  ): CommandPayload[] {
    const persistent = payload.nodes.filter((node) => !isDynamicId(node.nodeId));
    const dynamic = payload.nodes.filter((node) => isDynamicId(node.nodeId));
    const commands: CommandPayload[] = [];
    if (persistent.length > 0) {
      commands.push({ type: "styles.set", nodes: persistent });
    }

    const groups = new Map<
      HTMLElement,
      Array<{ path: string; patch: DynamicNodePatch }>
    >();
    for (const change of dynamic) {
      const located = this.locateByDynamicId(change.nodeId);
      if (!located) continue;
      const styles: Record<string, DynamicStyleEntry> = {};
      for (const declaration of change.after) {
        styles[declaration.property] = {
          value: declaration.value,
          priority: declaration.priority
        };
      }
      const entries = groups.get(located.anchor) ?? [];
      entries.push({ path: located.path, patch: { styles } });
      groups.set(located.anchor, entries);
    }
    for (const [anchor, entries] of groups) {
      const command = this.buildAnchorCommand(anchor, entries);
      if (command) commands.push(command);
    }
    return commands;
  }

  private patchCommandFor(
    nodeId: string,
    patch: DynamicNodePatch
  ): CommandPayload[] {
    const located = this.locateByDynamicId(nodeId);
    if (!located) return [];
    const command = this.buildAnchorCommand(located.anchor, [
      { path: located.path, patch }
    ]);
    return command ? [command] : [];
  }

  private locateByDynamicId(
    nodeId: string
  ): { anchor: HTMLElement; path: string } | null {
    const element = document.querySelector<HTMLElement>(
      `[data-hs-id="${nodeId}"]`
    );
    if (!element) return null;
    const anchor = persistentAnchorOf(element.parentElement);
    if (!anchor) return null;
    const path = pathBetween(anchor, element);
    if (path === "") return null;
    return { anchor, path };
  }

  private buildAnchorCommand(
    anchor: HTMLElement,
    entries: Array<{ path: string; patch: DynamicNodePatch }>
  ): CommandPayload | null {
    const before = anchor.getAttribute(DYNAMIC_PATCH_ATTRIBUTE);
    const manifest = this.readManifest(anchor);
    for (const { path, patch } of entries) {
      const current = manifest[path] ?? {};
      if (patch.styles) {
        current.styles = { ...current.styles, ...patch.styles };
      }
      if (patch.text !== undefined) current.text = patch.text;
      if (patch.html !== undefined) current.html = patch.html;
      if (patch.attrs) {
        current.attrs = { ...current.attrs, ...patch.attrs };
      }
      manifest[path] = current;
    }
    const after = JSON.stringify(manifest);
    if (after === before) return null;
    anchor.setAttribute(DYNAMIC_PATCH_ATTRIBUTE, after);
    return {
      type: "attribute.set",
      nodeId: idOf(anchor),
      name: DYNAMIC_PATCH_ATTRIBUTE,
      before,
      after
    };
  }

  private readManifest(anchor: HTMLElement): AnchorManifest {
    const raw = anchor.getAttribute(DYNAMIC_PATCH_ATTRIBUTE);
    if (!raw) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === "object"
        ? parsed as AnchorManifest
        : {};
    } catch {
      return {};
    }
  }

  private shouldSkip(element: Element): boolean {
    if (SKIPPED_TAGS.has(element.tagName)) return true;
    if (element.closest("[data-hs-overlay]")) return true;
    if (
      element instanceof SVGElement
      && element.tagName.toLowerCase() !== "svg"
    ) {
      return true;
    }
    // Chart internals are managed by the chart adapters, not as documents.
    if (element.parentElement?.closest("[_echarts_instance_]")) return true;
    return false;
  }

  private assignIds(root: Element): void {
    // Never tag <html> or <body> — body is the root container; tagging it
    // makes it absorb pointer events for every element in the document.
    if (root === document.body || root === document.documentElement) return;
    const candidates: Element[] = root instanceof HTMLElement
      || root instanceof SVGElement
      ? [root, ...root.querySelectorAll("*")]
      : [...root.querySelectorAll("*")];
    for (const element of candidates) {
      if (element === document.body || element === document.documentElement) continue;
      if (element.hasAttribute("data-hs-id") || this.shouldSkip(element)) {
        continue;
      }
      element.setAttribute(
        "data-hs-id",
        `${DYNAMIC_ID_PREFIX}${(this.counter++).toString(36)}`
      );
    }
  }

  private scheduleReplay(): void {
    if (this.replayQueued) return;
    this.replayQueued = true;
    queueMicrotask(() => {
      this.replayQueued = false;
      this.replayAll();
    });
  }

  /**
   * Re-apply every anchor's manifest to its dynamic descendants. Public so
   * the runtime can force a re-application after a programmatic mutation
   * (e.g. undo/redo replacing the data-hs-dyn-patches attribute).
   */
  replay(): void {
    this.replayAll();
  }

  private replayAll(): void {
    for (const anchor of document.querySelectorAll<HTMLElement>(
      `[${DYNAMIC_PATCH_ATTRIBUTE}]`
    )) {
      const manifest = this.readManifest(anchor);
      for (const [path, patch] of Object.entries(manifest)) {
        const element = this.locateByPath(anchor, path);
        if (element) this.applyPatch(element, patch);
      }
    }
  }

  private locateByPath(anchor: Element, path: string): HTMLElement | null {
    if (path === "") return null;
    let current: Element | null = anchor;
    for (const token of path.split(".")) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0) return null;
      current = current?.children.item(index) ?? null;
      if (!current) return null;
    }
    return current instanceof HTMLElement ? current : null;
  }

  private applyPatch(element: HTMLElement, patch: DynamicNodePatch): void {
    if (patch.styles) {
      for (const [property, entry] of Object.entries(patch.styles)) {
        if (
          element.style.getPropertyValue(property) !== entry.value
          || element.style.getPropertyPriority(property)
            !== (entry.priority === "important" ? "important" : "")
        ) {
          element.style.setProperty(property, entry.value, entry.priority);
        }
      }
    }
    if (patch.attrs) {
      for (const [name, value] of Object.entries(patch.attrs)) {
        if (value === null) element.removeAttribute(name);
        else if (element.getAttribute(name) !== value) {
          element.setAttribute(name, value);
        }
      }
    }
    if (
      patch.text !== undefined
      && element.children.length === 0
      && element.textContent !== patch.text
    ) {
      element.textContent = patch.text;
    }
    if (patch.html !== undefined && element.innerHTML !== patch.html) {
      element.innerHTML = patch.html;
    }
  }
}
