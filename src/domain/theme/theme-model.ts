export type ThemeTokenKind =
  | "color"
  | "font"
  | "size"
  | "radius"
  | "spacing"
  | "shadow";

export interface ThemeToken {
  id: string;
  name: string;
  cssVariable: `--${string}`;
  kind: ThemeTokenKind;
  light: string;
  dark?: string;
}

export interface ProjectTheme {
  version: 1;
  name: string;
  mode: "light" | "dark";
  applyBaseStyles: boolean;
  tokens: ThemeToken[];
}

export const DEFAULT_PROJECT_THEME: ProjectTheme = {
  version: 1,
  name: "默认品牌",
  mode: "light",
  applyBaseStyles: false,
  tokens: [
    { id: "primary", name: "主色", cssVariable: "--hs-primary", kind: "color", light: "#315efb", dark: "#7c9cff" },
    { id: "secondary", name: "辅助色", cssVariable: "--hs-secondary", kind: "color", light: "#7c3aed", dark: "#a78bfa" },
    { id: "background", name: "背景色", cssVariable: "--hs-background", kind: "color", light: "#ffffff", dark: "#0f1115" },
    { id: "heading-font", name: "标题字体", cssVariable: "--hs-heading-font", kind: "font", light: "Inter, system-ui, sans-serif" },
    { id: "body-font", name: "正文字体", cssVariable: "--hs-body-font", kind: "font", light: "Inter, system-ui, sans-serif" },
    { id: "base-size", name: "基础字号", cssVariable: "--hs-base-size", kind: "size", light: "16px" },
    { id: "radius", name: "圆角", cssVariable: "--hs-radius", kind: "radius", light: "12px" },
    { id: "spacing", name: "基础间距", cssVariable: "--hs-spacing", kind: "spacing", light: "8px" },
    { id: "shadow", name: "阴影", cssVariable: "--hs-shadow", kind: "shadow", light: "0 12px 30px rgba(15, 23, 42, 0.12)", dark: "0 12px 30px rgba(0, 0, 0, 0.35)" }
  ]
};

export function validateTheme(theme: ProjectTheme): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const variables = new Set<string>();
  for (const token of theme.tokens) {
    if (ids.has(token.id)) errors.push(`主题令牌 ID “${token.id}”重复`);
    if (variables.has(token.cssVariable)) {
      errors.push(`CSS 变量“${token.cssVariable}”重复`);
    }
    if (!/^--[a-z][a-z0-9-]*$/i.test(token.cssVariable)) {
      errors.push(`CSS 变量“${token.cssVariable}”格式无效`);
    }
    ids.add(token.id);
    variables.add(token.cssVariable);
  }
  return errors;
}

function declarations(theme: ProjectTheme, mode: "light" | "dark"): string {
  return theme.tokens.map((token) =>
    `  ${token.cssVariable}: ${mode === "dark" ? token.dark ?? token.light : token.light};`
  ).join("\n");
}

export function renderThemeCss(theme: ProjectTheme): string {
  const darkTokens = theme.tokens.some((token) => token.dark !== undefined);
  return [
    ":root {",
    declarations(theme, "light"),
    "}",
    darkTokens
      ? `[data-hs-theme-mode="dark"] {\n${declarations(theme, "dark")}\n}`
      : "",
    theme.applyBaseStyles
      ? [
        "body {",
        "  color: var(--hs-text, inherit);",
        "  background-color: var(--hs-background);",
        "  font-family: var(--hs-body-font);",
        "  font-size: var(--hs-base-size);",
        "}",
        "h1, h2, h3, h4, h5, h6 {",
        "  font-family: var(--hs-heading-font);",
        "}",
        "button, [role=\"button\"] {",
        "  border-radius: var(--hs-radius);",
        "}"
      ].join("\n")
      : ""
  ].filter(Boolean).join("\n\n");
}
