import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECT_THEME,
  renderThemeCss,
  validateTheme
} from "./theme-model";

describe("project theme", () => {
  it("renders light and dark CSS variables", () => {
    const css = renderThemeCss(DEFAULT_PROJECT_THEME);
    expect(css).toContain(":root {");
    expect(css).toContain("--hs-primary: #315efb");
    expect(css).toContain('[data-hs-theme-mode="dark"]');
  });

  it("rejects duplicate variables", () => {
    const theme = {
      ...DEFAULT_PROJECT_THEME,
      tokens: [
        DEFAULT_PROJECT_THEME.tokens[0]!,
        { ...DEFAULT_PROJECT_THEME.tokens[1]!, cssVariable: "--hs-primary" as const }
      ]
    };
    expect(validateTheme(theme)).toContain("CSS 变量“--hs-primary”重复");
  });
});
