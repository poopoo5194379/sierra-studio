import type { CommandPayload } from "../domain/commands/schema";
import {
  DYNAMIC_ID_PREFIX,
  idOf,
  isDynamicId,
  pathBetween,
  persistentAnchorOf,
  persistedIdOf,
  ROOT_NODE_ID
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
  locator?: {
    attribute: "id" | "data-key" | "data-id" | "data-uid";
    value: string;
    tagName: string;
  };
}

type AnchorManifest = Record<string, DynamicNodePatch>;

const SKIPPED_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "META", "TEMPLATE"]);
const ANCHOR_SELF_PATH = "$";

function normalizedDynamicHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const element of template.content.querySelectorAll<HTMLElement>(
    "[data-hs-id]"
  )) {
    const nodeId = element.getAttribute("data-hs-id");
    if (nodeId && isDynamicId(nodeId)) {
      element.removeAttribute("data-hs-id");
    }
  }
  return template.innerHTML;
}

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
          return this.patchStructureForParent(
            payload.parentId,
            payload.node.id
          );
        }
        return [payload];
      case "node.delete":
        if (isDynamicId(payload.nodeId) || isDynamicId(payload.parentId)) {
          return this.patchStructureForParent(payload.parentId);
        }
        return [payload];
      case "node.move":
        if (isDynamicId(payload.nodeId) || isDynamicId(payload.parentId)) {
          return this.patchStructureForParent(payload.parentId);
        }
        return [payload];
      case "chart.patch":
        return [payload];
      case "text.patchStyle":
        return isDynamicId(payload.nodeId)
          ? this.patchCommandFor(payload.nodeId, { html: payload.after })
          : [payload];
      case "document.patch":
        return [payload];
      case "component.update":
        return this.convertComponentUpdate(payload);
      case "watermarks.set":
        return [payload];
    }
  }

  private convertComponentUpdate(
    payload: Extract<CommandPayload, { type: "component.update" }>
  ): CommandPayload[] {
    const persistent: Extract<
      CommandPayload,
      { type: "component.update" }
    > = {
      type: "component.update",
      texts: payload.texts.filter((change) => !isDynamicId(change.nodeId)),
      html: payload.html.filter((change) => !isDynamicId(change.nodeId)),
      styles: payload.styles.filter((change) => !isDynamicId(change.nodeId)),
      attributes: payload.attributes.filter(
        (change) => !isDynamicId(change.nodeId)
      )
    };
    const anchorChanges = new Map<
      string,
      Extract<CommandPayload, { type: "attribute.set" }>
    >();
    const remember = (commands: CommandPayload[]): void => {
      for (const command of commands) {
        if (command.type !== "attribute.set") continue;
        const key = `${command.nodeId}\u0000${command.name}`;
        const existing = anchorChanges.get(key);
        anchorChanges.set(key, existing
          ? { ...command, before: existing.before }
          : command);
      }
    };

    for (const change of payload.texts) {
      if (isDynamicId(change.nodeId)) {
        remember(this.patchCommandFor(change.nodeId, { text: change.after }));
      }
    }
    for (const change of payload.html) {
      if (isDynamicId(change.nodeId)) {
        remember(this.patchCommandFor(change.nodeId, { html: change.after }));
      }
    }
    for (const change of payload.attributes) {
      if (isDynamicId(change.nodeId)) {
        remember(this.patchCommandFor(change.nodeId, {
          attrs: { [change.name]: change.after }
        }));
      }
    }
    const dynamicStyles = payload.styles.filter(
      (change) => isDynamicId(change.nodeId)
    );
    if (dynamicStyles.length > 0) {
      remember(this.convertStyles({
        type: "styles.set",
        nodes: dynamicStyles
      }));
    }

    const commands: CommandPayload[] = [];
    if (
      persistent.texts.length > 0
      || persistent.html.length > 0
      || persistent.styles.length > 0
      || persistent.attributes.length > 0
    ) {
      commands.push(persistent);
    }
    if (anchorChanges.size > 0) {
      commands.push({
        type: "document.patch",
        attributes: [...anchorChanges.values()].map((change) => ({
          nodeId: change.nodeId,
          name: change.name,
          before: change.before,
          after: change.after
        })),
        managedStyles: []
      });
    }
    return commands;
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
      entries.push({
        path: located.path,
        patch: {
          styles,
          ...(located.locator ? { locator: located.locator } : {})
        }
      });
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
    const persistedPatch = patch.html === undefined
      ? patch
      : { ...patch, html: normalizedDynamicHtml(patch.html) };
    const command = this.buildAnchorCommand(located.anchor, [
      {
        path: located.path,
        patch: {
          ...persistedPatch,
          ...(located.locator ? { locator: located.locator } : {})
        }
      }
    ]);
    return command ? [command] : [];
  }

  /**
   * Structural edits inside script-generated regions are persisted by
   * freezing only the affected parent subtree into its nearest anchor
   * manifest. The rest of the page remains live and script-driven.
   */
  private patchStructureForParent(
    parentId: string,
    insertedNodeId?: string
  ): CommandPayload[] {
    const parent = parentId === ROOT_NODE_ID
      ? document.body
      : document.querySelector<HTMLElement>(
        `[data-hs-id="${CSS.escape(parentId)}"]`
      );
    if (!parent) return [];

    // A regular insertion command creates a persistent-looking node_ id.
    // Since the node only exists inside a generated subtree, convert it to a
    // runtime ID before serializing; future edits must continue through this
    // manifest rather than target a non-existent node in the working HTML.
    if (insertedNodeId) {
      const inserted = parent.querySelector<HTMLElement>(
        `[data-hs-id="${CSS.escape(insertedNodeId)}"]`
      );
      if (inserted) {
        inserted.removeAttribute("data-hs-id");
        this.assignIds(inserted);
      }
    }

    const patch: DynamicNodePatch = {
      html: normalizedDynamicHtml(parent.innerHTML)
    };
    let command: CommandPayload | null = null;
    if (isDynamicId(parentId)) {
      return this.patchCommandFor(parentId, patch);
    }
    command = this.buildAnchorCommand(parent, [{
      path: ANCHOR_SELF_PATH,
      patch
    }]);
    if (!command) return [];
    postToHost({
      type: "notice",
      message: "已将该脚本区域局部冻结，结构修改会在刷新后保留"
    });
    return [command];
  }

  private locateByDynamicId(
    nodeId: string
  ): {
    anchor: HTMLElement;
    path: string;
    locator?: DynamicNodePatch["locator"];
  } | null {
    const element = document.querySelector<HTMLElement>(
      `[data-hs-id="${nodeId}"]`
    );
    if (!element) return null;
    const anchor = persistentAnchorOf(element.parentElement);
    if (!anchor) return null;
    const path = pathBetween(anchor, element);
    if (path === "") return null;
    return {
      anchor,
      path,
      locator: this.stableLocator(anchor, element)
    };
  }

  private stableLocator(
    anchor: HTMLElement,
    element: HTMLElement
  ): DynamicNodePatch["locator"] | undefined {
    for (const attribute of [
      "id",
      "data-key",
      "data-id",
      "data-uid"
    ] as const) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const matches = [...anchor.querySelectorAll<HTMLElement>(
        `[${attribute}]`
      )].filter((candidate) => candidate.getAttribute(attribute) === value);
      if (matches.length === 1) {
        return {
          attribute,
          value,
          tagName: element.tagName.toLowerCase()
        };
      }
    }
    return undefined;
  }

  private buildAnchorCommand(
    anchor: HTMLElement,
    entries: Array<{ path: string; patch: DynamicNodePatch }>
  ): CommandPayload | null {
    const before = anchor.getAttribute(DYNAMIC_PATCH_ATTRIBUTE);
    const manifest = this.readManifest(anchor);
    for (const { path, patch } of entries) {
      // If an ancestor already owns an HTML patch, a nested patch would be
      // replayed after the ancestor and then erased again by that ancestor on
      // the next observer cycle. Fold the current subtree into the ancestor
      // patch so there is a single source of truth.
      const owningHtmlPath = Object.keys(manifest)
        .filter((candidate) =>
          (
            (candidate === ANCHOR_SELF_PATH && path !== ANCHOR_SELF_PATH)
            || path.startsWith(`${candidate}.`)
          )
          && manifest[candidate]?.html !== undefined
        )
        .sort((left, right) => right.length - left.length)[0];
      if (owningHtmlPath) {
        const owner = this.locateByPath(anchor, owningHtmlPath);
        if (owner) {
          manifest[owningHtmlPath] = {
            ...manifest[owningHtmlPath],
            html: normalizedDynamicHtml(owner.innerHTML)
          };
          continue;
        }
      }

      // A new parent HTML patch already contains the rendered state of its
      // descendants, so obsolete child entries must not replay against it.
      if (patch.html !== undefined) {
        for (const candidate of Object.keys(manifest)) {
          if (
            path === ANCHOR_SELF_PATH
            || candidate.startsWith(`${path}.`)
          ) {
            if (candidate !== path) delete manifest[candidate];
          }
        }
      }
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
      nodeId: persistedIdOf(anchor),
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
    // Page scripts often finish rendering before the editor runtime starts.
    // Do not tag html/body themselves, but always traverse their descendants.
    const includeRoot =
      root !== document.body
      && root !== document.documentElement
      && (root instanceof HTMLElement || root instanceof SVGElement);
    const candidates: Element[] = includeRoot
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
        const element = this.locateByPath(anchor, path, patch.locator);
        if (element) this.applyPatch(element, patch);
      }
    }
  }

  private locateByPath(
    anchor: Element,
    path: string,
    locator?: DynamicNodePatch["locator"]
  ): HTMLElement | null {
    if (locator) {
      const located = [...anchor.querySelectorAll<HTMLElement>(
        `${locator.tagName}[${locator.attribute}]`
      )].find(
        (candidate) =>
          candidate.getAttribute(locator.attribute) === locator.value
      );
      if (located) return located;
    }
    if (path === ANCHOR_SELF_PATH) {
      return anchor instanceof HTMLElement ? anchor : null;
    }
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
    // Runtime IDs are assigned by the MutationObserver and must not make an
    // otherwise identical HTML patch look stale. Without normalization,
    // replay replaces the subtree, the observer assigns IDs again, and the
    // resulting observer/replay cycle can starve Electron's renderer.
    if (
      patch.html !== undefined
      && normalizedDynamicHtml(element.innerHTML)
        !== normalizedDynamicHtml(patch.html)
    ) {
      element.innerHTML = patch.html;
    }
  }
}
