import type {
  CommandPayload,
  StyleDeclaration
} from "../../domain/commands/schema";
import {
  parseFieldSet,
  serializeFieldSet,
  type ComponentSelection
} from "../../domain/components/component-model";

const COMPONENT_ID = "data-hs-component-id";
const COMPONENT_NAME = "data-hs-component-name";
const COMPONENT_VERSION = "data-hs-component-version";
const COMPONENT_ROLE = "data-hs-component-role";
const INSTANCE_ID = "data-hs-component-instance";
const FIELD = "data-hs-component-field";
const FIELD_KIND = "data-hs-component-field-kind";
const OVERRIDES = "data-hs-component-overrides";
const CONFLICTS = "data-hs-component-conflicts";

interface FieldContext {
  node: HTMLElement;
  root: HTMLElement;
  field: HTMLElement;
  componentId: string;
  fieldKey: string;
}

type ComponentUpdate = Extract<
  CommandPayload,
  { type: "component.update" }
>;

function persistentId(element: HTMLElement): string {
  return element.getAttribute("data-hs-id") ?? "";
}

function setAttributeChange(
  changes: ComponentUpdate["attributes"],
  element: HTMLElement,
  name: string,
  after: string | null
): void {
  const before = element.getAttribute(name);
  if (before === after) return;
  if (after === null) element.removeAttribute(name);
  else element.setAttribute(name, after);
  changes.push({
    nodeId: persistentId(element),
    name,
    before,
    after
  });
}

export class ComponentController {
  constructor(
    private readonly commit: (payload: CommandPayload) => void
  ) {}

  describe(element: HTMLElement): ComponentSelection | undefined {
    const root = element.closest<HTMLElement>(`[${COMPONENT_ID}]`);
    if (!root) return undefined;
    const componentId = root.getAttribute(COMPONENT_ID);
    const instanceId = root.getAttribute(INSTANCE_ID);
    if (!componentId || !instanceId) return undefined;
    const field = element.closest<HTMLElement>(`[${FIELD}]`);
    return {
      componentId,
      name: root.getAttribute(COMPONENT_NAME) ?? "未命名组件",
      version: Number(root.getAttribute(COMPONENT_VERSION) ?? 1),
      role: root.getAttribute(COMPONENT_ROLE) === "master"
        ? "master"
        : "instance",
      instanceId,
      instanceCount: document.querySelectorAll(
        `[${COMPONENT_ID}="${CSS.escape(componentId)}"]`
      ).length,
      ...(field?.closest(`[${COMPONENT_ID}]`) === root
        && field.getAttribute(FIELD)
        ? { fieldKey: field.getAttribute(FIELD)! }
        : {}),
      overrides: [...parseFieldSet(root.getAttribute(OVERRIDES))],
      conflicts: [...parseFieldSet(root.getAttribute(CONFLICTS))]
    };
  }

  create(element: HTMLElement, name: string): void {
    const nodeId = persistentId(element);
    if (!nodeId || nodeId.startsWith("dyn_")) {
      throw new Error("动态元素需要先物化为静态副本才能创建组件");
    }
    if (element.closest(`[${COMPONENT_ID}]`)) {
      throw new Error("所选元素已经属于一个组件");
    }
    const componentId = `cmp_${crypto.randomUUID()}`;
    const instanceId = `cinst_${crypto.randomUUID()}`;
    const attributes: Extract<
      CommandPayload,
      { type: "document.patch" }
    >["attributes"] = [];
    const apply = (
      target: HTMLElement,
      attribute: string,
      value: string
    ): void => {
      const before = target.getAttribute(attribute);
      target.setAttribute(attribute, value);
      attributes.push({
        nodeId: persistentId(target),
        name: attribute,
        before,
        after: value
      });
    };
    apply(element, COMPONENT_ID, componentId);
    apply(element, COMPONENT_NAME, name.trim() || "未命名组件");
    apply(element, COMPONENT_VERSION, "1");
    apply(element, COMPONENT_ROLE, "master");
    apply(element, INSTANCE_ID, instanceId);
    apply(element, OVERRIDES, "[]");
    apply(element, CONFLICTS, "[]");

    let textIndex = 0;
    let imageIndex = 0;
    let linkIndex = 0;
    let mediaIndex = 0;
    const all = [element, ...element.querySelectorAll<HTMLElement>("[data-hs-id]")];
    for (const candidate of all) {
      if (!persistentId(candidate).startsWith("node_")
        && !persistentId(candidate).includes("-")) {
        // Imported IDs can use other stable shapes; only reject runtime IDs.
        if (persistentId(candidate).startsWith("dyn_")) continue;
      }
      let key = "";
      let kind = "";
      if (candidate instanceof HTMLImageElement) {
        key = `image-${++imageIndex}`;
        kind = "image";
      } else if (candidate instanceof HTMLAnchorElement) {
        key = `link-${++linkIndex}`;
        kind = "link";
      } else if (candidate instanceof HTMLVideoElement) {
        key = `media-${++mediaIndex}`;
        kind = "media";
      } else if (
        candidate.textContent?.trim()
        && candidate.children.length === 0
        && !candidate.matches("script, style")
      ) {
        key = `text-${++textIndex}`;
        kind = "text";
      }
      if (!key) continue;
      apply(candidate, FIELD, key);
      apply(candidate, FIELD_KIND, kind);
    }
    this.commit({
      type: "document.patch",
      attributes,
      managedStyles: []
    });
  }

  duplicate(element: HTMLElement): HTMLElement {
    const root = element.closest<HTMLElement>(`[${COMPONENT_ID}]`);
    if (!root || !root.parentElement) {
      throw new Error("请先选择一个组件或组件内元素");
    }
    const clone = root.cloneNode(true) as HTMLElement;
    for (const candidate of [clone, ...clone.querySelectorAll<HTMLElement>(
      "[data-hs-id]"
    )]) {
      candidate.setAttribute("data-hs-id", `node_${crypto.randomUUID()}`);
      candidate.removeAttribute("contenteditable");
      candidate.classList.remove("hs-hover-outline");
    }
    clone.setAttribute(COMPONENT_ROLE, "instance");
    clone.setAttribute(INSTANCE_ID, `cinst_${crypto.randomUUID()}`);
    clone.setAttribute(OVERRIDES, "[]");
    clone.setAttribute(CONFLICTS, "[]");
    root.parentElement.insertBefore(clone, root.nextSibling);
    const attributes: Record<string, string> = {};
    for (const attribute of [...clone.attributes]) {
      if (attribute.name !== "data-hs-id") {
        attributes[attribute.name] = attribute.value;
      }
    }
    this.commit({
      type: "node.insert",
      parentId: root.parentElement === document.body
        ? "__hs_body__"
        : persistentId(root.parentElement),
      index: [...root.parentElement.children].indexOf(clone),
      node: {
        id: persistentId(clone),
        tagName: clone.tagName.toLowerCase(),
        attributes,
        text: clone.innerHTML
      }
    });
    return clone;
  }

  detach(element: HTMLElement): void {
    const root = element.closest<HTMLElement>(`[${COMPONENT_ID}]`);
    if (!root) throw new Error("所选元素不属于组件");
    const attributes: Extract<
      CommandPayload,
      { type: "document.patch" }
    >["attributes"] = [];
    const remove = (target: HTMLElement, name: string): void => {
      const before = target.getAttribute(name);
      if (before === null) return;
      target.removeAttribute(name);
      attributes.push({
        nodeId: persistentId(target),
        name,
        before,
        after: null
      });
    };
    for (const name of [
      COMPONENT_ID,
      COMPONENT_NAME,
      COMPONENT_VERSION,
      COMPONENT_ROLE,
      INSTANCE_ID,
      OVERRIDES,
      CONFLICTS
    ]) remove(root, name);
    for (const field of root.querySelectorAll<HTMLElement>(`[${FIELD}]`)) {
      remove(field, FIELD);
      remove(field, FIELD_KIND);
    }
    this.commit({
      type: "document.patch",
      attributes,
      managedStyles: []
    });
  }

  resetCurrentField(element: HTMLElement): void {
    const context = this.context(element);
    if (!context) throw new Error("请先选择组件字段");
    if (context.root.getAttribute(COMPONENT_ROLE) === "master") {
      throw new Error("主组件字段没有实例覆盖");
    }
    const master = this.roots(context.componentId).find(
      (root) => root.getAttribute(COMPONENT_ROLE) === "master"
    );
    const masterField = master?.querySelector<HTMLElement>(
      `[${FIELD}="${CSS.escape(context.fieldKey)}"]`
    );
    if (!masterField) throw new Error("找不到主组件字段");
    const update = this.emptyUpdate();
    if (
      context.field.getAttribute(FIELD_KIND) === "text"
      && masterField.children.length === 0
    ) {
      const before = context.field.textContent ?? "";
      const after = masterField.textContent ?? "";
      context.field.textContent = after;
      update.texts.push({
        nodeId: persistentId(context.field),
        before,
        after
      });
    }
    for (const name of ["src", "alt", "href", "title", "style"]) {
      const before = context.field.getAttribute(name);
      const after = masterField.getAttribute(name);
      if (before === after) continue;
      if (after === null) context.field.removeAttribute(name);
      else context.field.setAttribute(name, after);
      update.attributes.push({
        nodeId: persistentId(context.field),
        name,
        before,
        after
      });
    }
    const overrides = parseFieldSet(context.root.getAttribute(OVERRIDES));
    overrides.delete(context.fieldKey);
    setAttributeChange(
      update.attributes,
      context.root,
      OVERRIDES,
      serializeFieldSet(overrides)
    );
    const conflicts = parseFieldSet(context.root.getAttribute(CONFLICTS));
    conflicts.delete(context.fieldKey);
    setAttributeChange(
      update.attributes,
      context.root,
      CONFLICTS,
      serializeFieldSet(conflicts)
    );
    this.commit(update);
  }

  convert(payload: CommandPayload): CommandPayload {
    if (payload.type === "component.update") return payload;
    if (payload.type === "text.set" || payload.type === "text.patchStyle") {
      return this.convertContent(payload);
    }
    if (payload.type === "attribute.set") {
      return this.convertAttribute(payload);
    }
    if (payload.type === "styles.set") {
      return this.convertStyles(payload);
    }
    return payload;
  }

  private convertContent(
    payload: Extract<
      CommandPayload,
      { type: "text.set" | "text.patchStyle" }
    >
  ): CommandPayload {
    const context = this.contextById(payload.nodeId);
    if (!context) return payload;
    const update = this.emptyUpdate();
    const changes = payload.type === "text.set" ? update.texts : update.html;
    changes.push({
      nodeId: payload.nodeId,
      before: payload.before,
      after: payload.after
    });
    this.expandField(context, update, (target) => {
      const before = payload.type === "text.set"
        ? target.textContent ?? ""
        : target.innerHTML;
      if (payload.type === "text.set") target.textContent = payload.after;
      else target.innerHTML = payload.after;
      changes.push({
        nodeId: persistentId(target),
        before,
        after: payload.after
      });
    });
    return update;
  }

  private convertAttribute(
    payload: Extract<CommandPayload, { type: "attribute.set" }>
  ): CommandPayload {
    const context = this.contextById(payload.nodeId);
    if (!context) return payload;
    const update = this.emptyUpdate();
    update.attributes.push({
      nodeId: payload.nodeId,
      name: payload.name,
      before: payload.before,
      after: payload.after
    });
    this.expandField(context, update, (target) => {
      const before = target.getAttribute(payload.name);
      if (payload.after === null) target.removeAttribute(payload.name);
      else target.setAttribute(payload.name, payload.after);
      update.attributes.push({
        nodeId: persistentId(target),
        name: payload.name,
        before,
        after: payload.after
      });
    });
    return update;
  }

  private convertStyles(
    payload: Extract<CommandPayload, { type: "styles.set" }>
  ): CommandPayload {
    if (payload.nodes.length !== 1) return payload;
    const source = payload.nodes[0]!;
    const context = this.contextById(source.nodeId);
    if (!context) return payload;
    const update = this.emptyUpdate();
    update.styles.push(source);
    this.expandField(context, update, (target) => {
      const before: StyleDeclaration[] = source.after.map((declaration) => ({
        property: declaration.property,
        value: target.style.getPropertyValue(declaration.property),
        priority: target.style.getPropertyPriority(declaration.property) ===
          "important" ? "important" : "",
        existed: target.style.getPropertyValue(declaration.property) !== ""
      }));
      for (const declaration of source.after) {
        if (!declaration.existed) {
          target.style.removeProperty(declaration.property);
        } else {
          target.style.setProperty(
            declaration.property,
            declaration.value,
            declaration.priority
          );
        }
      }
      update.styles.push({
        nodeId: persistentId(target),
        before,
        after: source.after
      });
    });
    return update;
  }

  private expandField(
    context: FieldContext,
    update: ComponentUpdate,
    applyToTarget: (target: HTMLElement) => void
  ): void {
    const role = context.root.getAttribute(COMPONENT_ROLE);
    if (role !== "master") {
      const overrides = parseFieldSet(context.root.getAttribute(OVERRIDES));
      overrides.add(context.fieldKey);
      setAttributeChange(
        update.attributes,
        context.root,
        OVERRIDES,
        serializeFieldSet(overrides)
      );
      return;
    }
    const currentVersion = Number(
      context.root.getAttribute(COMPONENT_VERSION) ?? 1
    );
    const nextVersion = String(currentVersion + 1);
    for (const root of this.roots(context.componentId)) {
      setAttributeChange(
        update.attributes,
        root,
        COMPONENT_VERSION,
        nextVersion
      );
      if (root === context.root) continue;
      const overrides = parseFieldSet(root.getAttribute(OVERRIDES));
      const target = root.querySelector<HTMLElement>(
        `[${FIELD}="${CSS.escape(context.fieldKey)}"]`
      );
      if (!target) continue;
      if (overrides.has(context.fieldKey)) {
        const conflicts = parseFieldSet(root.getAttribute(CONFLICTS));
        conflicts.add(context.fieldKey);
        setAttributeChange(
          update.attributes,
          root,
          CONFLICTS,
          serializeFieldSet(conflicts)
        );
        continue;
      }
      applyToTarget(target);
    }
  }

  private contextById(nodeId: string): FieldContext | null {
    const node = document.querySelector<HTMLElement>(
      `[data-hs-id="${CSS.escape(nodeId)}"]`
    );
    return node ? this.context(node) : null;
  }

  private context(node: HTMLElement): FieldContext | null {
    const root = node.closest<HTMLElement>(`[${COMPONENT_ID}]`);
    const field = node.closest<HTMLElement>(`[${FIELD}]`);
    if (!root || !field || field.closest(`[${COMPONENT_ID}]`) !== root) {
      return null;
    }
    const componentId = root.getAttribute(COMPONENT_ID);
    const fieldKey = field.getAttribute(FIELD);
    if (!componentId || !fieldKey) return null;
    return { node, root, field, componentId, fieldKey };
  }

  private roots(componentId: string): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(
      `[${COMPONENT_ID}="${CSS.escape(componentId)}"]`
    )];
  }

  private emptyUpdate(): ComponentUpdate {
    return {
      type: "component.update",
      texts: [],
      html: [],
      styles: [],
      attributes: []
    };
  }
}
