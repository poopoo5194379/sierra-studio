import type {
  CommandPayload,
  StyleDeclaration
} from "../domain/commands/schema";
import type {
  ChartPatch,
  ChartSnapshot
} from "./charts/types";

export interface SelectionSnapshot {
  count: number;
  nodeIds: string[];
  nodeId: string;
  tagName: string;
  textAlign: string;
  fontSize: string;
  position: string;
  isComponent: boolean;
  width: number;
  height: number;
  text: string;
  canEditText: boolean;
  borderRadius?: string;
  backgroundColor?: string;
  imageSrc?: string;
  hasTextSelection?: boolean;
  /** GrapesJS StyleManager: live text formatting state of the cursor/selection */
  textFormat?: {
    bold: boolean;
    italic: boolean;
    underline: boolean;
    foreColor: string;
    hiliteColor: string;
    fontSize: string;
  };
  isSymbol?: boolean;
  symbolId?: string;
  /** true when the element has data-hs-chart (chart block) */
  isChartBlock?: boolean;
  chart?: ChartSnapshot;
}

export interface EditorState {
  scrollX: number;
  scrollY: number;
  selectedNodeIds: string[];
}

/** GrapesJS LayerManager: a flat tree node for the sidebar layer panel. */
export interface LayerNode {
  id: string;
  tag: string;
  text: string;
  children: LayerNode[];
}

export type HostToEditorMessage =
  | { source: "html-studio-host"; action: "ping" }
  | {
      source: "html-studio-host";
      action: "set-style";
      declarations: Array<Pick<StyleDeclaration, "property" | "value" | "priority">>;
    }
  | { source: "html-studio-host"; action: "convert-free" }
  | { source: "html-studio-host"; action: "set-text"; text: string }
  | {
      source: "html-studio-host";
      action: "align";
      alignment: "left" | "center" | "right" | "top" | "middle" | "bottom";
    }
  | { source: "html-studio-host"; action: "clear-selection" }
  | {
      source: "html-studio-host";
      action: "chart-patch";
      patch: ChartPatch;
    }
  | { source: "html-studio-host"; action: "image"; path: string }
  | { source: "html-studio-host"; action: "save-editor-state" }
  | {
      source: "html-studio-host";
      action: "restore-editor-state";
      state: EditorState;
    }
  | { source: "html-studio-host"; action: "request-copy" }
  | { source: "html-studio-host"; action: "paste"; clipboardData: string }
  | { source: "html-studio-host"; action: "text-style"; property: string; value: string }
  | { source: "html-studio-host"; action: "call-delete" }
  | { source: "html-studio-host"; action: "clone-selected" }
  | { source: "html-studio-host"; action: "adjust-zindex"; delta: number }
  | { source: "html-studio-host"; action: "request-layers" }
  | { source: "html-studio-host"; action: "request-source" }
  | { source: "html-studio-host"; action: "change-chart-type"; chartType: "line" | "bar" | "area" | "pie" }
  | { source: "html-studio-host"; action: "import-csv-data" }
  | { source: "html-studio-host"; action: "import-video" }
  | { source: "html-studio-host"; action: "set-attribute"; name: string; value: string }
  | { source: "html-studio-host"; action: "nudge"; dx: number; dy: number }
  | { source: "html-studio-host"; action: "select-all-in-container" }
  | { source: "html-studio-host"; action: "edit-selected" }
  | { source: "html-studio-host"; action: "toggle-symbol" }
  | { source: "html-studio-host"; action: "select-next-sibling"; forward: boolean }
  | { source: "html-studio-host"; action: "insert-block"; blockType: string }
  | {
      /**
       * Apply a command in-place on the live DOM without reloading the iframe.
       * Used by undo (inverse command) and redo (forward command) — the
       * GrapesJS UndoManager pattern. The host runs the SQLite update; the
       * runtime applies the same operation to the live DOM so the user sees
       * the change instantly without a flicker or scroll jump.
       */
      source: "html-studio-host";
      action: "apply-command";
      payload: CommandPayload;
    };

type WithoutSource<T> = T extends unknown ? Omit<T, "source"> : never;
export type HostToEditorPayload = WithoutSource<HostToEditorMessage>;

export type EditorToHostMessage =
  | { source: "html-studio-agent"; type: "ready" }
  | {
      source: "html-studio-agent";
      type: "selection";
      selection: SelectionSnapshot;
    }
  | {
      source: "html-studio-agent";
      type: "command";
      payload: CommandPayload;
    }
  | { source: "html-studio-agent"; type: "notice"; message: string }
  | {
      source: "html-studio-agent";
      type: "editor-state";
      state: EditorState;
    }
  | {
      source: "html-studio-agent";
      type: "clipboard-data";
      data: string;
    }
  | {
      source: "html-studio-agent";
      type: "context-menu";
      nodeId: string;
      posX: number;
      posY: number;
    }
  | {
      source: "html-studio-agent";
      type: "layers";
      layers: LayerNode[];
    }
  | {
      source: "html-studio-agent";
      type: "source-code";
      html: string;
    }
  | {
      /** Phase 9: floating toolbar position near text selection */
      source: "html-studio-agent";
      type: "text-select-pos";
      x: number;
      y: number;
      visible: boolean;
    };

export type EditorToHostPayload = WithoutSource<EditorToHostMessage>;

export function postToHost(
  message: EditorToHostPayload
): void {
  window.parent.postMessage(
    { source: "html-studio-agent", ...message } satisfies EditorToHostMessage,
    "*"
  );
}

export function isHostMessage(value: unknown): value is HostToEditorMessage {
  return Boolean(
    value
    && typeof value === "object"
    && "source" in value
    && value.source === "html-studio-host"
    && "action" in value
  );
}
