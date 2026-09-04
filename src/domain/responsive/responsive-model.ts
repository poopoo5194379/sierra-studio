export type BreakpointDirection = "max-width" | "min-width";

export interface BreakpointDefinition {
  id: string;
  name: string;
  width: number;
  height: number;
  direction: BreakpointDirection;
  mediaWidth?: number;
  builtIn?: boolean;
}

export interface ResponsiveProjectSettings {
  version: 1;
  activeBreakpointId: string;
  breakpoints: BreakpointDefinition[];
}

export type ResponsiveIssueKind =
  | "horizontal-overflow"
  | "text-clipped"
  | "image-overflow"
  | "small-interactive-target";

export interface ResponsiveIssue {
  id: string;
  nodeId: string;
  kind: ResponsiveIssueKind;
  severity: "error" | "warning";
  message: string;
  measured?: number;
  expected?: number;
}

export interface ResponsiveAuditReport {
  viewportWidth: number;
  viewportHeight: number;
  scannedElements: number;
  issues: ResponsiveIssue[];
}

export const DEFAULT_BREAKPOINTS: readonly BreakpointDefinition[] = [
  {
    id: "desktop",
    name: "桌面",
    width: 1440,
    height: 900,
    direction: "max-width",
    builtIn: true
  },
  {
    id: "tablet",
    name: "平板",
    width: 768,
    height: 1024,
    direction: "max-width",
    mediaWidth: 991,
    builtIn: true
  },
  {
    id: "mobile",
    name: "手机",
    width: 390,
    height: 844,
    direction: "max-width",
    mediaWidth: 767,
    builtIn: true
  }
] as const;

export function createResponsiveSettings(): ResponsiveProjectSettings {
  return {
    version: 1,
    activeBreakpointId: "desktop",
    breakpoints: DEFAULT_BREAKPOINTS.map((breakpoint) => ({ ...breakpoint }))
  };
}

export function validateBreakpoints(
  breakpoints: readonly BreakpointDefinition[]
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const mediaKeys = new Set<string>();
  for (const breakpoint of breakpoints) {
    if (!/^[a-z][a-z0-9_-]*$/i.test(breakpoint.id)) {
      errors.push(`断点 ID “${breakpoint.id}”格式无效`);
    }
    if (ids.has(breakpoint.id)) errors.push(`断点 ID “${breakpoint.id}”重复`);
    ids.add(breakpoint.id);
    if (
      !Number.isInteger(breakpoint.width)
      || breakpoint.width < 240
      || breakpoint.width > 7680
    ) {
      errors.push(`断点“${breakpoint.name}”的画布宽度超出范围`);
    }
    if (
      !Number.isInteger(breakpoint.height)
      || breakpoint.height < 240
      || breakpoint.height > 7680
    ) {
      errors.push(`断点“${breakpoint.name}”的画布高度超出范围`);
    }
    if (breakpoint.mediaWidth !== undefined) {
      const key = `${breakpoint.direction}:${breakpoint.mediaWidth}`;
      if (mediaKeys.has(key)) {
        errors.push(`断点“${breakpoint.name}”与其他断点的媒体范围重复`);
      }
      mediaKeys.add(key);
    }
  }
  return errors;
}

export function breakpointForViewport(
  settings: ResponsiveProjectSettings,
  viewportWidth: number
): BreakpointDefinition {
  const fallback = settings.breakpoints[0];
  if (!fallback) {
    throw new Error("Responsive settings require at least one breakpoint");
  }
  const candidates = settings.breakpoints
    .filter((breakpoint) => breakpoint.mediaWidth !== undefined)
    .sort((left, right) => {
      if (left.direction === "max-width") {
        return (left.mediaWidth ?? 0) - (right.mediaWidth ?? 0);
      }
      return (right.mediaWidth ?? 0) - (left.mediaWidth ?? 0);
    });
  return candidates.find((breakpoint) =>
    breakpoint.direction === "max-width"
      ? viewportWidth <= (breakpoint.mediaWidth ?? 0)
      : viewportWidth >= (breakpoint.mediaWidth ?? 0)
  ) ?? fallback;
}

export function rotateBreakpoint(
  breakpoint: BreakpointDefinition
): BreakpointDefinition {
  return {
    ...breakpoint,
    width: breakpoint.height,
    height: breakpoint.width
  };
}
