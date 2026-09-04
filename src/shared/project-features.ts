import {
  createResponsiveSettings,
  validateBreakpoints,
  type ResponsiveProjectSettings
} from "../domain/responsive/responsive-model";
import {
  DEFAULT_PROJECT_THEME,
  validateTheme,
  type ProjectTheme
} from "../domain/theme/theme-model";
import {
  createWatermarkSettings,
  parseWatermarkSettings,
  type WatermarkSettings
} from "../domain/watermarks/watermark-model";

export interface ProjectFeatures {
  version: 1;
  responsive: ResponsiveProjectSettings;
  theme: ProjectTheme;
  watermarks: WatermarkSettings;
}

export function createProjectFeatures(): ProjectFeatures {
  return {
    version: 1,
    responsive: createResponsiveSettings(),
    theme: structuredClone(DEFAULT_PROJECT_THEME),
    watermarks: createWatermarkSettings()
  };
}

export function parseProjectFeatures(value: unknown): ProjectFeatures {
  if (!value || typeof value !== "object") return createProjectFeatures();
  const candidate = value as Partial<ProjectFeatures>;
  const fallback = createProjectFeatures();
  const responsive = candidate.responsive
    && candidate.responsive.version === 1
    && Array.isArray(candidate.responsive.breakpoints)
    && validateBreakpoints(candidate.responsive.breakpoints).length === 0
    && candidate.responsive.breakpoints.some(
      (breakpoint) => breakpoint.id === candidate.responsive?.activeBreakpointId
    )
    ? candidate.responsive
    : fallback.responsive;
  const validTheme = candidate.theme
    && candidate.theme.version === 1
    && Array.isArray(candidate.theme.tokens)
    && validateTheme(candidate.theme).length === 0;
  const theme = validTheme && candidate.theme
    ? {
      ...candidate.theme,
      mode: candidate.theme.mode === "dark" ? "dark" as const : "light" as const,
      applyBaseStyles: candidate.theme.applyBaseStyles === true
    }
    : fallback.theme;
  const watermarks = parseWatermarkSettings(candidate.watermarks);
  return { version: 1, responsive, theme, watermarks };
}
