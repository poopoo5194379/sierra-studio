export interface ImportedScriptPolicy {
  mode: "strip" | "sandboxed";
  allowInlineScripts: boolean;
  allowProjectScripts: boolean;
  allowNetwork: boolean;
}

export const SANDBOXED_SCRIPT_POLICY: ImportedScriptPolicy = {
  mode: "sandboxed",
  allowInlineScripts: true,
  allowProjectScripts: true,
  allowNetwork: false
};

export const STRIP_SCRIPT_POLICY: ImportedScriptPolicy = {
  mode: "strip",
  allowInlineScripts: false,
  allowProjectScripts: false,
  allowNetwork: false
};
