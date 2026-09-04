import type { CommandPayload } from "../../domain/commands/schema";
import type {
  BreakpointDefinition,
  ResponsiveAuditReport,
  ResponsiveIssue
} from "../../domain/responsive/responsive-model";
import {
  parseResponsiveManifest,
  renderResponsiveCss,
  responsiveIssue,
  upsertResponsiveRule,
  type ResponsiveDeclaration,
  type ResponsiveNodeManifest
} from "../../domain/responsive/responsive-rules";

const MANIFEST_ATTRIBUTE = "data-hs-responsive-rules";
const STYLE_ID = "responsive";
const MAX_AUDIT_ELEMENTS = 20_000;
const AUDIT_BATCH_SIZE = 500;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export class ResponsiveController {
  private readonly previews = new Map<string, {
    nodeId: string;
    beforeClass: string | null;
    beforeManifest: string | null;
    beforeCss: string | null;
  }>();

  constructor(
    private readonly commit: (payload: CommandPayload) => void
  ) {}

  preview(
    element: HTMLElement,
    breakpoint: BreakpointDefinition,
    declarations: readonly ResponsiveDeclaration[]
  ): void {
    const key = this.previewKey(element, breakpoint);
    if (!this.previews.has(key)) {
      this.previews.set(key, {
        nodeId: element.getAttribute("data-hs-id") ?? "",
        beforeClass: element.getAttribute("class"),
        beforeManifest: element.getAttribute(MANIFEST_ATTRIBUTE),
        beforeCss: document.querySelector<HTMLStyleElement>(
          `style[data-hs-managed-style="${STYLE_ID}"]`
        )?.textContent ?? null
      });
    }
    this.mutate(element, breakpoint, declarations);
  }

  commitPreview(
    element: HTMLElement,
    breakpoint: BreakpointDefinition,
    declarations: readonly ResponsiveDeclaration[]
  ): void {
    const key = this.previewKey(element, breakpoint);
    const preview = this.previews.get(key);
    if (!preview) {
      this.apply(element, breakpoint, declarations);
      return;
    }
    this.mutate(element, breakpoint, declarations);
    this.previews.delete(key);
    this.commitPatch(element, preview);
  }

  apply(
    element: HTMLElement,
    breakpoint: BreakpointDefinition,
    declarations: readonly ResponsiveDeclaration[]
  ): void {
    const before = {
      nodeId: element.getAttribute("data-hs-id") ?? "",
      beforeClass: element.getAttribute("class"),
      beforeManifest: element.getAttribute(MANIFEST_ATTRIBUTE),
      beforeCss: document.querySelector<HTMLStyleElement>(
        `style[data-hs-managed-style="${STYLE_ID}"]`
      )?.textContent ?? null
    };
    this.mutate(element, breakpoint, declarations);
    this.commitPatch(element, before);
  }

  private mutate(
    element: HTMLElement,
    breakpoint: BreakpointDefinition,
    declarations: readonly ResponsiveDeclaration[]
  ): void {
    const nodeId = element.getAttribute("data-hs-id");
    if (!nodeId || nodeId.startsWith("dyn_")) {
      throw new Error("动态元素需要先物化为静态副本才能保存断点样式");
    }
    const manifest = upsertResponsiveRule(
      parseResponsiveManifest(
        element.getAttribute(MANIFEST_ATTRIBUTE),
        nodeId
      ),
      breakpoint,
      declarations
    );
    const afterManifest = JSON.stringify(manifest);
    const classNames = new Set(element.classList);
    classNames.add(manifest.className);
    const afterClass = [...classNames].join(" ");
    const style = document.querySelector<HTMLStyleElement>(
      `style[data-hs-managed-style="${STYLE_ID}"]`
    );
    element.setAttribute("class", afterClass);
    element.setAttribute(MANIFEST_ATTRIBUTE, afterManifest);
    const afterCss = this.rebuildCss();
    const targetStyle = style ?? document.createElement("style");
    targetStyle.dataset.hsManagedStyle = STYLE_ID;
    targetStyle.textContent = afterCss;
    if (!style) (document.head ?? document.documentElement).append(targetStyle);

  }

  private commitPatch(
    element: HTMLElement,
    before: {
      nodeId: string;
      beforeClass: string | null;
      beforeManifest: string | null;
      beforeCss: string | null;
    }
  ): void {
    this.commit({
      type: "document.patch",
      attributes: [
        {
          nodeId: before.nodeId,
          name: "class",
          before: before.beforeClass,
          after: element.getAttribute("class")
        },
        {
          nodeId: before.nodeId,
          name: MANIFEST_ATTRIBUTE,
          before: before.beforeManifest,
          after: element.getAttribute(MANIFEST_ATTRIBUTE)
        }
      ],
      managedStyles: [{
        styleId: STYLE_ID,
        before: before.beforeCss,
        after: document.querySelector<HTMLStyleElement>(
          `style[data-hs-managed-style="${STYLE_ID}"]`
        )?.textContent ?? null
      }]
    });
  }

  private previewKey(
    element: HTMLElement,
    breakpoint: BreakpointDefinition
  ): string {
    return `${element.getAttribute("data-hs-id") ?? ""}:${breakpoint.id}`;
  }

  rulesFor(element: HTMLElement): string[] {
    const nodeId = element.getAttribute("data-hs-id") ?? "";
    return parseResponsiveManifest(
      element.getAttribute(MANIFEST_ATTRIBUTE),
      nodeId
    ).rules.map((rule) => rule.breakpointId);
  }

  importedMediaQueries(): string[] {
    const media = new Set<string>();
    for (const sheet of [...document.styleSheets]) {
      try {
        this.collectMediaRules(sheet.cssRules, media);
      } catch {
        // Cross-origin stylesheets are reported by compatibility scanning.
      }
    }
    return [...media].sort();
  }

  async audit(): Promise<ResponsiveAuditReport> {
    const elements = [
      ...document.body.querySelectorAll<HTMLElement>("[data-hs-id]")
    ].slice(0, MAX_AUDIT_ELEMENTS);
    const issues: ResponsiveIssue[] = [];
    const viewportWidth = document.documentElement.clientWidth;
    for (let index = 0; index < elements.length; index += AUDIT_BATCH_SIZE) {
      for (const element of elements.slice(index, index + AUDIT_BATCH_SIZE)) {
        this.auditElement(element, viewportWidth, issues);
      }
      if (index + AUDIT_BATCH_SIZE < elements.length) await nextFrame();
    }
    return {
      viewportWidth,
      viewportHeight: document.documentElement.clientHeight,
      scannedElements: elements.length,
      issues
    };
  }

  private rebuildCss(): string {
    const manifests: ResponsiveNodeManifest[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(
      `[${MANIFEST_ATTRIBUTE}]`
    )) {
      const nodeId = element.getAttribute("data-hs-id") ?? "";
      manifests.push(parseResponsiveManifest(
        element.getAttribute(MANIFEST_ATTRIBUTE),
        nodeId
      ));
    }
    return renderResponsiveCss(manifests);
  }

  private collectMediaRules(
    rules: CSSRuleList,
    output: Set<string>
  ): void {
    for (const rule of [...rules]) {
      if (rule instanceof CSSMediaRule) {
        output.add(rule.conditionText);
        this.collectMediaRules(rule.cssRules, output);
      }
    }
  }

  private auditElement(
    element: HTMLElement,
    viewportWidth: number,
    issues: ResponsiveIssue[]
  ): void {
    const nodeId = element.dataset.hsId;
    if (!nodeId) return;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    if (rect.left < -1 || rect.right > viewportWidth + 1) {
      issues.push(responsiveIssue(
        nodeId,
        "horizontal-overflow",
        "元素超出当前画布宽度",
        Math.round(Math.max(0, rect.right - viewportWidth)),
        0
      ));
    }
    const computed = getComputedStyle(element);
    if (
      (computed.overflowX === "hidden" || computed.overflowY === "hidden")
      && (
        element.scrollWidth > element.clientWidth + 1
        || element.scrollHeight > element.clientHeight + 1
      )
    ) {
      issues.push(responsiveIssue(
        nodeId,
        "text-clipped",
        "内容可能被截断"
      ));
    }
    if (
      element instanceof HTMLImageElement
      && element.parentElement
      && rect.width > element.parentElement.getBoundingClientRect().width + 1
    ) {
      issues.push(responsiveIssue(
        nodeId,
        "image-overflow",
        "图片宽度超过父容器"
      ));
    }
    if (
      element.matches("button, a, input, select, textarea, [role='button']")
      && (rect.width < 44 || rect.height < 44)
    ) {
      issues.push(responsiveIssue(
        nodeId,
        "small-interactive-target",
        "可点击区域小于建议的 44 × 44 像素",
        Math.round(Math.min(rect.width, rect.height)),
        44
      ));
    }
  }
}
