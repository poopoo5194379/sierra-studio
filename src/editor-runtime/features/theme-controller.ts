import type { CommandPayload } from "../../domain/commands/schema";

const STYLE_ID = "theme";
const MODE_ATTRIBUTE = "data-hs-theme-mode";
const BODY_NODE_ID = "__hs_body__";

interface ThemeState {
  beforeCss: string | null;
  beforeMode: string | null;
}

export class ThemeController {
  private previewState: ThemeState | null = null;

  constructor(
    private readonly commit: (payload: CommandPayload) => void
  ) {}

  preview(css: string, mode: "light" | "dark"): void {
    this.previewState ??= this.readState();
    this.mutate(css, mode);
  }

  commitPreview(css: string, mode: "light" | "dark"): void {
    const before = this.previewState ?? this.readState();
    this.previewState = null;
    this.mutate(css, mode);
    this.commit({
      type: "document.patch",
      attributes: [{
        nodeId: BODY_NODE_ID,
        name: MODE_ATTRIBUTE,
        before: before.beforeMode,
        after: mode
      }],
      managedStyles: [{
        styleId: STYLE_ID,
        before: before.beforeCss,
        after: css
      }]
    });
  }

  cancelPreview(): void {
    if (!this.previewState) return;
    this.restore(this.previewState);
    this.previewState = null;
  }

  private readState(): ThemeState {
    return {
      beforeCss: document.querySelector<HTMLStyleElement>(
        `style[data-hs-managed-style="${STYLE_ID}"]`
      )?.textContent ?? null,
      beforeMode: document.body.getAttribute(MODE_ATTRIBUTE)
    };
  }

  private mutate(css: string, mode: "light" | "dark"): void {
    document.body.setAttribute(MODE_ATTRIBUTE, mode);
    let style = document.querySelector<HTMLStyleElement>(
      `style[data-hs-managed-style="${STYLE_ID}"]`
    );
    if (!style) {
      style = document.createElement("style");
      style.dataset.hsManagedStyle = STYLE_ID;
      (document.head ?? document.documentElement).append(style);
    }
    style.textContent = css;
  }

  private restore(state: ThemeState): void {
    if (state.beforeMode === null) {
      document.body.removeAttribute(MODE_ATTRIBUTE);
    } else {
      document.body.setAttribute(MODE_ATTRIBUTE, state.beforeMode);
    }
    const style = document.querySelector<HTMLStyleElement>(
      `style[data-hs-managed-style="${STYLE_ID}"]`
    );
    if (state.beforeCss === null) style?.remove();
    else {
      const target = style ?? document.createElement("style");
      target.dataset.hsManagedStyle = STYLE_ID;
      target.textContent = state.beforeCss;
      if (!style) (document.head ?? document.documentElement).append(target);
    }
  }
}
