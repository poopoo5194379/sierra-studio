export type CompatibilitySeverity = "ok" | "info" | "warning" | "blocked";

export interface CompatibilityFinding {
  code: string;
  severity: CompatibilitySeverity;
  category:
    | "dependency"
    | "dynamic"
    | "asset"
    | "structure"
    | "security"
    | "export";
  title: string;
  detail: string;
  count?: number;
}

export interface ImportCompatibilityReport {
  level: "good" | "partial" | "limited";
  mode: "static" | "dynamic-report" | "web-app";
  findings: CompatibilityFinding[];
  detectedDependencies: string[];
  metrics: {
    elements: number;
    scripts: number;
    remoteAssets: number;
    dynamicRenderers: number;
  };
}

