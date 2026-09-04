import type {
  BreakpointDefinition,
  ResponsiveIssue,
  ResponsiveIssueKind
} from "./responsive-model";

export interface ResponsiveDeclaration {
  property: string;
  value: string;
}

export interface ResponsiveRule {
  breakpointId: string;
  direction: "max-width" | "min-width";
  mediaWidth: number;
  declarations: ResponsiveDeclaration[];
}

export interface ResponsiveNodeManifest {
  version: 1;
  className: string;
  rules: ResponsiveRule[];
}

const SAFE_PROPERTY = /^-?[a-z][a-z0-9-]*$/i;
const SAFE_CLASS = /^hsr-[a-z0-9_-]+$/i;

export function responsiveClassForNode(nodeId: string): string {
  return `hsr-${nodeId.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`;
}

export function parseResponsiveManifest(
  value: string | null,
  nodeId: string
): ResponsiveNodeManifest {
  if (value) {
    try {
      const parsed = JSON.parse(value) as Partial<ResponsiveNodeManifest>;
      if (
        parsed.version === 1
        && typeof parsed.className === "string"
        && SAFE_CLASS.test(parsed.className)
        && Array.isArray(parsed.rules)
      ) {
        return {
          version: 1,
          className: parsed.className,
          rules: parsed.rules.filter((rule) =>
            typeof rule.breakpointId === "string"
            && (rule.direction === "max-width" || rule.direction === "min-width")
            && Number.isInteger(rule.mediaWidth)
            && Array.isArray(rule.declarations)
          ).map((rule) => ({
            ...rule,
            declarations: rule.declarations.filter((declaration) =>
              SAFE_PROPERTY.test(declaration.property)
              && typeof declaration.value === "string"
            )
          }))
        };
      }
    } catch {
      // Invalid editor metadata is replaced with a clean manifest.
    }
  }
  return {
    version: 1,
    className: responsiveClassForNode(nodeId),
    rules: []
  };
}

export function upsertResponsiveRule(
  manifest: ResponsiveNodeManifest,
  breakpoint: BreakpointDefinition,
  declarations: readonly ResponsiveDeclaration[]
): ResponsiveNodeManifest {
  if (breakpoint.mediaWidth === undefined) {
    throw new Error("Desktop/base styles do not require a media rule");
  }
  const existing = manifest.rules.find(
    (rule) => rule.breakpointId === breakpoint.id
  );
  const properties = new Map(
    existing?.declarations.map((declaration) => [
      declaration.property,
      declaration.value
    ]) ?? []
  );
  for (const declaration of declarations) {
    if (!SAFE_PROPERTY.test(declaration.property)) continue;
    if (declaration.value === "") properties.delete(declaration.property);
    else properties.set(declaration.property, declaration.value);
  }
  const nextRule: ResponsiveRule = {
    breakpointId: breakpoint.id,
    direction: breakpoint.direction,
    mediaWidth: breakpoint.mediaWidth,
    declarations: [...properties].map(([property, value]) => ({
      property,
      value
    }))
  };
  return {
    ...manifest,
    rules: [
      ...manifest.rules.filter((rule) =>
        rule.breakpointId !== breakpoint.id
      ),
      ...(nextRule.declarations.length > 0 ? [nextRule] : [])
    ]
  };
}

export function renderResponsiveCss(
  manifests: readonly ResponsiveNodeManifest[]
): string {
  const groups = new Map<string, {
    direction: "max-width" | "min-width";
    width: number;
    blocks: string[];
  }>();
  for (const manifest of manifests) {
    if (!SAFE_CLASS.test(manifest.className)) continue;
    for (const rule of manifest.rules) {
      if (rule.declarations.length === 0) continue;
      const key = `${rule.direction}:${rule.mediaWidth}`;
      const group = groups.get(key) ?? {
        direction: rule.direction,
        width: rule.mediaWidth,
        blocks: []
      };
      const declarations = rule.declarations
        .filter((declaration) => SAFE_PROPERTY.test(declaration.property))
        .map((declaration) =>
          `    ${declaration.property}: ${declaration.value} !important;`
        )
        .join("\n");
      group.blocks.push(`  .${manifest.className} {\n${declarations}\n  }`);
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .sort((left, right) => right.width - left.width)
    .map((group) =>
      `@media (${group.direction}: ${group.width}px) {\n`
      + `${group.blocks.join("\n")}\n}`
    )
    .join("\n\n");
}

export function responsiveIssue(
  nodeId: string,
  kind: ResponsiveIssueKind,
  message: string,
  measured?: number,
  expected?: number
): ResponsiveIssue {
  return {
    id: `${kind}:${nodeId}`,
    nodeId,
    kind,
    severity: kind === "horizontal-overflow" ? "error" : "warning",
    message,
    ...(measured !== undefined ? { measured } : {}),
    ...(expected !== undefined ? { expected } : {})
  };
}
