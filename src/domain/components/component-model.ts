export type ComponentRole = "master" | "instance";

export interface ComponentSelection {
  componentId: string;
  name: string;
  version: number;
  role: ComponentRole;
  instanceId: string;
  instanceCount: number;
  fieldKey?: string;
  overrides: string[];
  conflicts: string[];
}

export function parseFieldSet(value: string | null): Set<string> {
  if (!value) return new Set();
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? new Set(parsed.filter((item): item is string =>
        typeof item === "string" && item.length > 0))
      : new Set();
  } catch {
    return new Set();
  }
}

export function serializeFieldSet(fields: Iterable<string>): string {
  return JSON.stringify([...new Set(fields)].sort());
}

