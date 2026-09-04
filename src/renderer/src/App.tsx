import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignHorizontalJustifyCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  BarChart3,
  Blocks,
  Bold,
  Box,
  ChevronDown,
  CircleHelp,
  Code2,
  Component,
  Copy,
  Download,
  FileCode2,
  FolderOpen,
  Image,
  Italic,
  Layers3,
  Link2,
  Maximize2,
  Minus,
  Monitor,
  Move,
  PanelLeft,
  Palette,
  Paintbrush,
  Plus,
  Redo2,
  RefreshCw,
  Save,
  SeparatorHorizontal,
  Smartphone,
  Stamp,
  ShieldCheck,
  Square,
  Tablet,
  Type,
  Underline,
  Undo2,
  Upload,
  Video
} from "lucide-react";
import type { CommandPayload } from "../../domain/commands/schema";
import type {
  EditorState,
  EditorToHostMessage,
  HostToEditorPayload,
  HostToEditorMessage,
  LayerNode,
  SelectionSnapshot
} from "../../editor-runtime/protocol";
import { CommandCoordinator } from "./editor/command-coordinator";
import type { PdfExportOptions } from "../../domain/pdf/export-options";
import type { PptxExportOptions } from "../../domain/pptx/export-options";
import {
  ChartDataSchema,
  type ChartData
} from "../../domain/charts/chart-types";
import { CanvasViewport } from "./editor/CanvasViewport";
import logoUrl from "./assets/logo.png";
import { cloudClient } from "./editor/cloud-client";
import type { ProjectSnapshot, ProjectSummary } from "../../shared/ipc";
import type { ImportCompatibilityReport } from "../../shared/import-compatibility";
import type { ProjectFeatures } from "../../shared/project-features";
import type {
  BreakpointDefinition,
  ResponsiveAuditReport
} from "../../domain/responsive/responsive-model";
import { ResponsiveToolbar } from "./features/responsive/ResponsiveToolbar";
import { BreakpointInspector } from "./features/responsive/BreakpointInspector";
import { ResponsiveAuditPanel } from "./features/responsive/ResponsiveAuditPanel";
import { ThemePanel } from "./features/theme/ThemePanel";
import {
  renderThemeCss,
  type ProjectTheme
} from "../../domain/theme/theme-model";
import type {
  DocumentElementFilter,
  DocumentNavigationResult
} from "../../domain/navigation/document-navigation";
import { DocumentNavigatorPanel } from "./features/navigation/DocumentNavigatorPanel";
import { ReusableComponentPanel } from "./features/components/ReusableComponentPanel";
import {
  ImageOrderDialog,
  type OrderedBatchImage
} from "./features/assets/ImageOrderDialog";
import { StyleLibraryPanel } from "./features/styles/StyleLibraryPanel";
import type {
  StylePreset,
  StylePresetTarget
} from "../../domain/styles/style-preset";
import {
  createWatermarkSettings,
  parseWatermarkSettings,
  type LegacyWatermarkCandidate,
  type WatermarkSettings
} from "../../domain/watermarks/watermark-model";
import { WatermarkPanel } from "./features/watermarks/WatermarkPanel";

interface ProjectState {
  projectId: string;
  documentId: string;
  revision: number;
  documentUrl: string;
  name: string;
  warnings: string[];
  compatibility: ImportCompatibilityReport;
  features: ProjectFeatures;
}

type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom";
type LeftPanel = "layers" | "insert" | "assets" | "theme" | "watermarks" | "help";
type InspectorTab = "content" | "styles" | "advanced";
type InsertPlacement = "flow" | "free";

const USER_STYLE_PRESETS_KEY = "sierra-studio:user-style-presets:v1";

function loadUserStylePresets(): StylePreset[] {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(USER_STYLE_PRESETS_KEY) ?? "[]"
    );
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is StylePreset =>
      Boolean(
        item
        && typeof item === "object"
        && "id" in item
        && "name" in item
        && "target" in item
        && "declarations" in item
        && Array.isArray(item.declarations)
      )
    );
  } catch {
    return [];
  }
}

function styleCategoryForTarget(target: StylePresetTarget): string {
  return {
    text: "文字",
    surface: "卡片",
    image: "图片",
    button: "按钮",
    table: "表格"
  }[target];
}

const BLOCK_GROUPS = [
  {
    label: "文字",
    items: [
      { type: "h1", label: "主标题", description: "页面级大标题", icon: Type },
      { type: "h2", label: "标题二", description: "内容区标题", icon: Type },
      { type: "h3", label: "小标题", description: "分组小标题", icon: Type },
      { type: "p", label: "正文", description: "普通段落文字", icon: PanelLeft }
    ]
  },
  {
    label: "布局",
    items: [
      { type: "card", label: "卡片", description: "带边框的内容容器", icon: Box },
      { type: "separator", label: "分隔线", description: "水平内容分隔", icon: SeparatorHorizontal },
      { type: "button", label: "按钮", description: "操作按钮", icon: Square }
    ]
  },
  {
    label: "媒体与数据",
    items: [
      { type: "img", label: "图片", description: "图片占位元素", icon: Image },
      { type: "video", label: "视频", description: "视频占位元素", icon: Video },
      { type: "chart", label: "图表", description: "可编辑数据图表", icon: BarChart3 }
    ]
  }
] as const;

function ChartDataJsonEditor({
  chartKey,
  data,
  onPatch,
  onInvalid
}: {
  chartKey: string;
  data: ChartData;
  onPatch: (data: ChartData) => void;
  onInvalid: (message: string) => void;
}): React.JSX.Element {
  const serialized = JSON.stringify(data, null, 2);
  const [draft, setDraft] = useState(serialized);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<number | null>(null);
  const lastSubmittedRef = useRef(serialized);

  useEffect(() => {
    const isOwnLiveUpdate =
      document.activeElement === textareaRef.current
      && serialized === lastSubmittedRef.current;
    if (isOwnLiveUpdate) return;
    setDraft(serialized);
    lastSubmittedRef.current = serialized;
  }, [chartKey, serialized]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const submit = (value: string, reportInvalid: boolean): void => {
    try {
      const parsed = ChartDataSchema.safeParse(JSON.parse(value));
      if (!parsed.success) {
        if (reportInvalid) onInvalid("图表数据 JSON 格式错误");
        return;
      }
      const normalized = JSON.stringify(parsed.data, null, 2);
      if (normalized === lastSubmittedRef.current) return;
      lastSubmittedRef.current = normalized;
      onPatch(parsed.data);
    } catch {
      if (reportInvalid) onInvalid("图表数据不是有效的 JSON");
    }
  };

  return (
    <textarea
      ref={textareaRef}
      className="chart-data-editor"
      value={draft}
      spellCheck={false}
      onChange={(event) => {
        const value = event.currentTarget.value;
        setDraft(value);
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          submit(value, false);
        }, 300);
      }}
      onBlur={(event) => {
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        submit(event.currentTarget.value, true);
      }}
    />
  );
}

function colorInputValue(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const hex = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    const digits = hex[1]!;
    return digits.length === 3
      ? `#${[...digits].map((digit) => digit + digit).join("")}`.toLowerCase()
      : `#${digits.toLowerCase()}`;
  }
  const rgb = value.match(
    /rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i
  );
  if (!rgb) return fallback;
  return `#${rgb.slice(1, 4).map((channel) =>
    Math.max(0, Math.min(255, Math.round(Number(channel))))
      .toString(16)
      .padStart(2, "0")
  ).join("")}`;
}

function LiveTextColorInput({
  title,
  property,
  value,
  fallback,
  style,
  onPreview,
  onCommit
}: {
  title: string;
  property: string;
  value: string | undefined;
  fallback: string;
  style?: React.CSSProperties;
  onPreview: (property: string, value: string) => void;
  onCommit: (property: string, value: string) => void;
}): React.JSX.Element {
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const flush = (): void => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending !== null) onCommit(property, pending);
  };

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  return (
    <input
      type="color"
      title={title}
      value={colorInputValue(value, fallback)}
      style={style}
      onInput={(event) => {
        const next = event.currentTarget.value;
        pendingRef.current = next;
        onPreview(property, next);
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(flush, 400);
      }}
      onBlur={flush}
    />
  );
}

function TextFontSizeInput({
  nodeId,
  fontSize,
  onPreview,
  onCommit
}: {
  nodeId: string;
  fontSize: string | undefined;
  onPreview: (value: string) => void;
  onCommit: (value: string) => void;
}): React.JSX.Element {
  const normalized = Math.min(
    240,
    Math.max(6, parseFloat(fontSize || "16") || 16)
  );
  const [draft, setDraft] = useState(String(normalized));
  const inputRef = useRef<HTMLInputElement>(null);
  const lastPreviewRef = useRef(`${normalized}px`);

  useEffect(() => {
    const next = `${normalized}px`;
    const isOwnPreview =
      document.activeElement === inputRef.current
      && lastPreviewRef.current === next;
    if (isOwnPreview) return;
    setDraft(String(normalized));
    lastPreviewRef.current = next;
  }, [nodeId, normalized]);

  const commit = (): void => {
    const parsed = parseFloat(draft);
    const next = Math.min(240, Math.max(6, Number.isFinite(parsed) ? parsed : normalized));
    const value = `${next}px`;
    setDraft(String(next));
    lastPreviewRef.current = value;
    onCommit(value);
  };

  return (
    <input
      ref={inputRef}
      className="text-font-size-input"
      type="number"
      title="字号"
      min="6"
      max="240"
      step="1"
      value={draft}
      onInput={(event) => {
        const nextDraft = event.currentTarget.value;
        setDraft(nextDraft);
        const parsed = parseFloat(nextDraft);
        if (!Number.isFinite(parsed) || parsed < 6 || parsed > 240) return;
        const value = `${parsed}px`;
        lastPreviewRef.current = value;
        onPreview(value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

export function App(): React.JSX.Element {
  const [project, setProject] = useState<ProjectState | null>(null);
  const [recentProjects, setRecentProjects] = useState<ProjectSummary[]>([]);
  const [selection, setSelection] = useState<SelectionSnapshot | null>(null);
  const [imageSlotSelection, setImageSlotSelection] = useState({
    active: false,
    candidates: 0,
    selected: 0
  });
  const [watermarkCandidates, setWatermarkCandidates] =
    useState<LegacyWatermarkCandidate[]>([]);
  const [watermarkFocus, setWatermarkFocus] = useState<{
    id: string;
    sequence: number;
  } | null>(null);
  const [pendingBatchImages, setPendingBatchImages] =
    useState<OrderedBatchImage[] | null>(null);
  const [documentStylePresets, setDocumentStylePresets] =
    useState<StylePreset[]>([]);
  const [userStylePresets, setUserStylePresets] =
    useState<StylePreset[]>(loadUserStylePresets);
  const [notice, setNotice] = useState("打开一个 HTML 文件开始编辑");
  const [busy, setBusy] = useState(false);
  const [operationLabel, setOperationLabel] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showPdfExport, setShowPdfExport] = useState(false);
  const [showPptxExport, setShowPptxExport] = useState(false);
  const [pptxExportSuccess, setPptxExportSuccess] = useState<{
    outputPath: string;
    slides: number;
    warnings: number;
  } | null>(null);
  const [showCompatibility, setShowCompatibility] = useState(false);
  const [responsiveAudit, setResponsiveAudit] = useState<{
    report: ResponsiveAuditReport;
    importedMediaQueries: string[];
  } | null>(null);
  const [responsiveAuditBusy, setResponsiveAuditBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pptxBusy, setPptxBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    nodeId: string;
    x: number;
    y: number;
  } | null>(null);
  const [layers, setLayers] = useState<LayerNode[]>([]);
  const [documentNavigation, setDocumentNavigation] =
    useState<DocumentNavigationResult | null>(null);
  const [leftPanel, setLeftPanel] = useState<LeftPanel>("insert");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("content");
  const [blockSearch, setBlockSearch] = useState("");
  const [insertPlacement, setInsertPlacement] = useState<InsertPlacement>("flow");
  const [formatPainterActive, setFormatPainterActive] = useState(false);
  const [showCodeView, setShowCodeView] = useState(false);
  const [codeContent, setCodeContent] = useState("");
  const [floatToolbar, setFloatToolbar] = useState<{ x: number; y: number } | null>(null);
  const [runtimeState, setRuntimeState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [cloudFileId, setCloudFileId] = useState<string | null>(null);
  const [cloudSaveStatus, setCloudSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [updateStatus, setUpdateStatus] = useState<"checking" | "available" | "latest" | "downloading" | "downloaded" | null>(null);
  const [showCloudPanel, setShowCloudPanel] = useState(false);

  useEffect(() => window.sierraStudio.onOperationProgress((event) => {
    setOperationLabel(event.active ? event.label ?? "正在处理…" : null);
  }), []);

  useEffect(() => {
    localStorage.setItem(
      USER_STYLE_PRESETS_KEY,
      JSON.stringify(userStylePresets)
    );
  }, [userStylePresets]);
  const [pdfOptions, setPdfOptions] = useState<PdfExportOptions>({
    mode: "smart",
    viewportWidth: 1440,
    viewportHeight: 900,
    targetPageHeight: 900
  });
  const [pptxOptions, setPptxOptions] = useState<PptxExportOptions>({
    mode: "hybrid",
    viewportWidth: 1600,
    viewportHeight: 900,
    slideWidth: 13.333,
    slideHeight: 7.5
  });
  const [canvasViewport, setCanvasViewport] = useState({
    width: 1440,
    height: 900
  });
  const activeBreakpoint = useMemo(() =>
    project?.features.responsive.breakpoints.find(
      (breakpoint) =>
        breakpoint.id === project.features.responsive.activeBreakpointId
    ) ?? null,
  [project]);

  useEffect(() => {
    setInspectorTab("content");
  }, [selection?.nodeId]);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const runtimeProbeRef = useRef<number | null>(null);
  const runtimeTimeoutRef = useRef<number | null>(null);
  const revisionRef = useRef(0);
  const editorStateRef = useRef<EditorState | null>(null);
  const cloudDebounceRef = useRef<number | null>(null);
  const historyQueueRef = useRef<Promise<void>>(Promise.resolve());
  const watermarkPersistenceQueueRef = useRef<Promise<void>>(
    Promise.resolve()
  );
  const lastCommandRef = useRef<CommandPayload | null>(null);
  const cloudFileIdRef = useRef<string | null>(null);
  const colorCommitTimersRef = useRef(new Map<string, number>());
  // Throttle refs removed during debugging

  const queueWatermarkPersistence = useCallback((
    projectId: string,
    features: ProjectFeatures
  ): Promise<void> => {
    watermarkPersistenceQueueRef.current = watermarkPersistenceQueueRef.current
      .catch(() => undefined)
      .then(() => window.sierraStudio.updateProjectFeatures({
        projectId,
        features
      }))
      .then(() => undefined);
    return watermarkPersistenceQueueRef.current;
  }, []);

  useEffect(() => () => {
    for (const timer of colorCommitTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    colorCommitTimersRef.current.clear();
  }, []);

  const activateProject = useCallback((nextProject: ProjectSnapshot): void => {
    revisionRef.current = nextProject.revision;
    setProject(nextProject);
    const activeBreakpoint = nextProject.features.responsive.breakpoints.find(
      (breakpoint) =>
        breakpoint.id === nextProject.features.responsive.activeBreakpointId
    ) ?? nextProject.features.responsive.breakpoints[0];
    if (activeBreakpoint) {
      setCanvasViewport({
        width: activeBreakpoint.width,
        height: activeBreakpoint.height
      });
    }
    setSelection(null);
    setImageSlotSelection({ active: false, candidates: 0, selected: 0 });
    setWatermarkCandidates([]);
    setWatermarkFocus(null);
    setReloadKey(0);
    try {
      localStorage.setItem("sierra-studio:last-project", nextProject.projectId);
    } catch {
      // Project restore remains optional when storage is unavailable.
    }
  }, []);

  useEffect(() => {
    let active = true;
    void window.sierraStudio.listProjects().then(async (projects) => {
      if (!active) return;
      setRecentProjects(projects);
      if (projects.length === 0) {
        try {
          const welcomeProject = await window.sierraStudio.ensureWelcomeProject();
          if (active) {
            activateProject(welcomeProject);
            setRecentProjects([{
              projectId: welcomeProject.projectId,
              name: welcomeProject.name,
              importedAt: new Date().toISOString()
            }]);
            setNotice("已打开入门样例，可以直接开始编辑");
          }
        } catch (error) {
          if (active) {
            setNotice(
              `创建入门样例失败：${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
        return;
      }
      let lastProjectId: string | null = null;
      try {
        lastProjectId = localStorage.getItem("sierra-studio:last-project");
      } catch {
        // Ignore storage restrictions and show the recent project list.
      }
      if (!lastProjectId || !projects.some(
        (candidate) => candidate.projectId === lastProjectId
      )) return;
      try {
        const restored = await window.sierraStudio.openProject(lastProjectId);
        if (active) {
          activateProject(restored);
          setNotice("已恢复上次编辑的项目");
        }
      } catch (error) {
        if (active) {
          setNotice(
            `恢复项目失败：${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }).catch((error: unknown) => {
      if (active) {
        setNotice(
          `读取本地项目失败：${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
    return () => {
      active = false;
    };
  }, [activateProject]);

  useEffect(() => {
    if (!project) return;
    setRuntimeState("loading");
    const probe = (): void => {
      iframeRef.current?.contentWindow?.postMessage({
        source: "html-studio-host",
        action: "ping"
      } satisfies HostToEditorMessage, "*");
    };
    probe();
    runtimeProbeRef.current = window.setInterval(probe, 500);
    runtimeTimeoutRef.current = window.setTimeout(() => {
      if (runtimeProbeRef.current !== null) {
        window.clearInterval(runtimeProbeRef.current);
        runtimeProbeRef.current = null;
      }
      setRuntimeState((current) =>
        current === "loading" ? "error" : current
      );
    }, 15000);
    return () => {
      if (runtimeProbeRef.current !== null) {
        window.clearInterval(runtimeProbeRef.current);
        runtimeProbeRef.current = null;
      }
      if (runtimeTimeoutRef.current !== null) {
        window.clearTimeout(runtimeTimeoutRef.current);
        runtimeTimeoutRef.current = null;
      }
    };
  }, [project?.projectId, reloadKey]);

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const target = event.target;
      const typing = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || (
          target instanceof HTMLElement
          && target.isContentEditable
        );
      if (typing && ctrl && (key === "z" || key === "y")) return;
      if (key === "z" && ctrl && event.shiftKey) {
        event.preventDefault();
        void moveHistory("redo");
        return;
      }
      if (key === "z" && ctrl) {
        event.preventDefault();
        void moveHistory("undo");
        return;
      }
      if (key === "y" && ctrl) {
        event.preventDefault();
        void moveHistory("redo");
        return;
      }
      if ((event.key === "c" || event.key === "C") && ctrl) {
        event.preventDefault();
        postToEditor({ action: "request-copy" });
        return;
      }
      if ((event.key === "v" || event.key === "V") && ctrl) {
        event.preventDefault();
        void (async () => {
          try {
            const text = await navigator.clipboard.readText();
            postToEditor({ action: "paste", clipboardData: text });
          } catch {
            setNotice("无法读取剪贴板，请用右键粘贴");
          }
        })();
        return;
      }
      if (event.key === "Delete" && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        postToEditor({ action: "clear-selection" });
        return;
      }
      // Clone (Ctrl+D) — GrapesJS core:component-clone
      if ((event.key === "d" || event.key === "D") && ctrl) {
        event.preventDefault();
        postToEditor({ action: "clone-selected" });
        return;
      }
      // Z-index: Ctrl+] bring forward, Ctrl+[ send back
      if (event.key === "]" && ctrl) {
        event.preventDefault();
        postToEditor({ action: "adjust-zindex", delta: 10 });
        return;
      }
      if (event.key === "[" && ctrl) {
        event.preventDefault();
        postToEditor({ action: "adjust-zindex", delta: -10 });
        return;
      }
      // Ctrl+A → select all in container (GrapesJS core:select-all)
      if ((event.key === "a" || event.key === "A") && ctrl) {
        event.preventDefault();
        postToEditor({ action: "select-all-in-container" });
        return;
      }
      // Ctrl+S → export HTML
      if ((event.key === "s" || event.key === "S") && ctrl) {
        event.preventDefault();
        void exportHtml();
        setNotice("导出中...");
        return;
      }
      // Enter → edit selected text element
      if (event.key === "Enter" && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        postToEditor({ action: "edit-selected" });
        return;
      }
      // Tab / Shift+Tab → select next/previous sibling
      if (event.key === "Tab" && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        postToEditor({ action: "select-next-sibling", forward: !event.shiftKey });
        return;
      }
      // Arrow keys → nudge (with Shift = 10px, without = 1px)
      const ARROWS: Record<string, [number, number]> = {
        ArrowUp: [0, -1], ArrowDown: [0, 1],
        ArrowLeft: [-1, 0], ArrowRight: [1, 0]
      };
      if (event.key in ARROWS && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        const [dx, dy] = ARROWS[event.key]!;
        const mul = event.shiftKey ? 10 : 1;
        postToEditor({ action: "nudge", dx: dx * mul, dy: dy * mul });
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const reloadAuthoritativeDocument = useCallback(() => {
    setSelection(null);
    setReloadKey((key) => key + 1);
  }, []);

  const postToEditor = useCallback((message: HostToEditorPayload) => {
    iframeRef.current?.contentWindow?.postMessage({
      source: "html-studio-host",
      ...message
    } satisfies HostToEditorMessage, "*");
  }, []);

  const scheduleColorCommit = useCallback((
    slot: string,
    message: HostToEditorPayload
  ): void => {
    const current = colorCommitTimersRef.current.get(slot);
    if (current !== undefined) window.clearTimeout(current);
    const timer = window.setTimeout(() => {
      colorCommitTimersRef.current.delete(slot);
      postToEditor(message);
    }, 250);
    colorCommitTimersRef.current.set(slot, timer);
  }, [postToEditor]);

  const coordinator = useMemo(() => new CommandCoordinator(
    () => revisionRef.current,
    (revision) => {
      revisionRef.current = revision;
    },
    (context, payload, baseRevision) => window.sierraStudio.executeCommand({
      projectId: context.projectId,
      command: {
        commandId: crypto.randomUUID(),
        commandVersion: 1,
        documentId: context.documentId,
        baseRevision,
        resultingRevision: baseRevision + 1,
        payload
      }
    }),
    (revision) => {
      setProject((current) => current && { ...current, revision });
      setNotice(`已保存 · Revision ${revision}`);
    },
    (error) => {
      setNotice(
        `保存失败：${error instanceof Error ? error.message : String(error)}`
      );
      // Runtime commands are optimistic. If persistence rejects one, reload
      // the authoritative working copy so the canvas cannot silently diverge.
      reloadAuthoritativeDocument();
    }
  ), [reloadAuthoritativeDocument]);

  // ── Cloud Save (debounced, 3 seconds after last edit) ──
  const saveToCloud = useCallback(async (commandPayload?: CommandPayload) => {
    if (!cloudClient.isEnabled) return;
    try {
      setCloudSaveStatus("saving");
      // Get current HTML from iframe — but only if ready, to avoid blocking
      const iframe = iframeRef.current;
      if (!iframe) { setCloudSaveStatus("idle"); return; }
      let html: string;
      try {
        const doc = iframe.contentDocument;
        if (!doc || !doc.documentElement) { setCloudSaveStatus("idle"); return; }
        html = "<!doctype html>\n" + doc.documentElement.outerHTML;
      } catch {
        // Cross-origin or detached — skip this snapshot
        setCloudSaveStatus("idle");
        return;
      }

      let fileId = cloudFileIdRef.current;
      if (!fileId) {
        // First upload
        const file = await cloudClient.uploadHtml(html, project?.documentId || "untitled");
        fileId = file.fileId;
        cloudFileIdRef.current = fileId;
        setCloudFileId(fileId);
      } else {
        await cloudClient.saveSnapshot(fileId, html, commandPayload || undefined);
      }
      lastCommandRef.current = null;
      setCloudSaveStatus("saved");
    } catch (err) {
      console.warn("[cloud save failed]", err);
      setCloudSaveStatus("error");
    }
  }, [project]);

  // Trigger debounced cloud save when a command is committed
  const scheduleCloudSave = useCallback((payload: CommandPayload) => {
    if (!cloudClient.isEnabled) return;
    lastCommandRef.current = payload;
    if (cloudDebounceRef.current !== null) {
      clearTimeout(cloudDebounceRef.current);
    }
    cloudDebounceRef.current = window.setTimeout(() => {
      cloudDebounceRef.current = null;
      void saveToCloud(lastCommandRef.current ?? undefined);
    }, 3000);
  }, [saveToCloud]);

  const commit = useCallback((payload: CommandPayload) => {
    if (!project) return;
    coordinator.enqueue({
      projectId: project.projectId,
      documentId: project.documentId
    }, payload);
    // scheduleCloudSave disabled to debug color freeze
    // scheduleCloudSave(payload);
  }, [coordinator, project]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<EditorToHostMessage>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = event.data;
      if (!message || message.source !== "html-studio-agent") return;

      // Throttle `selection` updates — TEMPORARILY DISABLED to debug color freeze
      // if (message.type === "selection") {
      //   const now = performance.now();
      //   if (now - selectionThrottleRef.current < 33) return;
      //   selectionThrottleRef.current = now;
      //   ...
      // }
      if (message.type === "selection") setSelection(message.selection);
      if (message.type === "image-slot-selection") {
        setImageSlotSelection({
          active: message.active,
          candidates: message.candidates,
          selected: message.selected
        });
      }
      if (message.type === "command") commit(message.payload);
      if (message.type === "notice") setNotice(message.message);
      if (message.type === "editor-state") {
        editorStateRef.current = message.state;
      }
      if (message.type === "clipboard-data") {
        void navigator.clipboard.writeText(message.data)
          .then(() => setNotice("已复制到剪贴板"))
          .catch(() => setNotice("复制失败"));
      }
      if (message.type === "context-menu") {
        setContextMenu({
          nodeId: message.nodeId,
          x: message.posX,
          y: message.posY
        });
      }
      if (message.type === "layers") {
        // Throttle disabled to debug color freeze
        // const now = performance.now();
        // if (now - layerThrottleRef.current < 50) return;
        // layerThrottleRef.current = now;
        setLayers(message.layers);
      }
      if (message.type === "document-navigation") {
        setDocumentNavigation(message.navigation);
      }
      if (message.type === "style-presets") {
        setDocumentStylePresets(message.presets);
      }
      if (message.type === "watermark-candidates") {
        setWatermarkCandidates(message.candidates);
      }
      if (message.type === "watermark-selected") {
        setLeftPanel("watermarks");
        setWatermarkFocus((current) => ({
          id: message.watermarkId,
          sequence: (current?.sequence ?? 0) + 1
        }));
      }
      if (message.type === "watermarks-changed" && project) {
        const features: ProjectFeatures = {
          ...project.features,
          watermarks: message.settings
        };
        setProject((current) => current && { ...current, features });
        void queueWatermarkPersistence(
          project.projectId,
          features
        ).catch((error) => {
          setNotice(
            `水印位置保存失败：${
              error instanceof Error ? error.message : String(error)
            }`
          );
        });
      }
      if (message.type === "history-request") {
        void moveHistory(message.direction);
      }
      if (message.type === "source-code") {
        setCodeContent(message.html);
      }
      if (message.type === "materialized-document" && project) {
        setBusy(true);
        setNotice("正在保存静态副本…");
        void window.sierraStudio.materializeProject({
          projectId: project.projectId,
          html: message.html
        }).then((snapshot) => {
          activateProject(snapshot);
          setShowCompatibility(false);
          setNotice(
            `静态副本已创建：${message.stats.elements} 个元素，`
            + `${message.stats.convertedDynamicIds} 个动态对象已转为普通对象`
          );
          setRecentProjects((current) => [{
            projectId: snapshot.projectId,
            name: snapshot.name,
            importedAt: new Date().toISOString()
          }, ...current.filter(
            (candidate) => candidate.projectId !== snapshot.projectId
          )]);
        }).catch((error) => {
          setNotice(
            `静态化失败：${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }).finally(() => setBusy(false));
      }
      if (message.type === "text-select-pos") {
        // Throttle: fires on every mouse move over text selection → 60 updates/sec
        // TEMPORARILY DISABLED to debug first-click color picker freeze
        // const now = performance.now();
        // if (now - toolbarThrottleRef.current < 50) return;
        // toolbarThrottleRef.current = now;
        setFloatToolbar(message.visible ? { x: message.x, y: message.y } : null);
      }
      if (message.type === "format-painter-state") {
        setFormatPainterActive(message.active);
      }
      if (message.type === "responsive-audit") {
        setResponsiveAudit({
          report: message.report,
          importedMediaQueries: message.importedMediaQueries
        });
        setResponsiveAuditBusy(false);
        setNotice(
          message.report.issues.length === 0
            ? "当前尺寸未发现明显响应式问题"
            : `发现 ${message.report.issues.length} 个响应式问题`
        );
      }
      if (message.type === "ready") {
        if (runtimeProbeRef.current !== null) {
          window.clearInterval(runtimeProbeRef.current);
          runtimeProbeRef.current = null;
        }
        if (runtimeTimeoutRef.current !== null) {
          window.clearTimeout(runtimeTimeoutRef.current);
          runtimeTimeoutRef.current = null;
        }
        setRuntimeState("ready");
        postToEditor({ action: "request-style-presets" });
        postToEditor({
          action: "sync-watermarks",
          settings: project?.features.watermarks ?? createWatermarkSettings()
        });
        postToEditor({ action: "request-watermark-candidates" });
        setNotice("画布已就绪：单击选择，双击文字编辑，Shift/Ctrl 多选");
        // Restore editor state after reload (undo/redo)
        const saved = editorStateRef.current;
        if (saved) {
          editorStateRef.current = null;
          setTimeout(() => {
            iframeRef.current?.contentWindow?.postMessage({
              source: "html-studio-host",
              action: "restore-editor-state",
              state: saved
            } satisfies HostToEditorMessage, "*");
          }, 200);
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [activateProject, commit, project, queueWatermarkPersistence]);

  // Auto-dismiss the floating text toolbar when clicking outside it or scrolling
  // useLayoutEffect so the listener is registered before the user can click
  useLayoutEffect(() => {
    if (!floatToolbar) return;
    const onOuter = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Element && target.closest(".float-toolbar")) return;
      setFloatToolbar(null);
    };
    const onInner = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Element && target.closest(".float-toolbar")) return;
      setFloatToolbar(null);
    };
    const onScroll = (): void => setFloatToolbar(null);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setFloatToolbar(null);
    };
    document.addEventListener("mousedown", onOuter, true);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("keydown", onKey, true);
    // Also listen inside the editing iframe (events there don't bubble to outer)
    const iframe = iframeRef.current;
    const innerDoc = iframe?.contentDocument;
    if (innerDoc) {
      innerDoc.addEventListener("mousedown", onInner, true);
      innerDoc.addEventListener("scroll", onScroll, true);
      innerDoc.addEventListener("keydown", onKey, true);
    }
    return () => {
      document.removeEventListener("mousedown", onOuter, true);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("keydown", onKey, true);
      if (innerDoc) {
        innerDoc.removeEventListener("mousedown", onInner, true);
        innerDoc.removeEventListener("scroll", onScroll, true);
        innerDoc.removeEventListener("keydown", onKey, true);
      }
    };
  }, [floatToolbar]);

  const importHtml = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.sierraStudio.importHtml();
      if (result.error) {
        setNotice(`导入失败：${result.error}`);
        return;
      }
      if (!result.canceled && result.project) {
        activateProject(result.project);
        setRecentProjects((current) => [{
          projectId: result.project!.projectId,
          name: result.project!.name,
          importedAt: new Date().toISOString()
        }, ...current.filter(
          (candidate) => candidate.projectId !== result.project!.projectId
        )]);
        setNotice(result.project.warnings.length > 0
          ? `已导入，有 ${result.project.warnings.length} 项资源或格式警告`
          : "已导入；单击对象开始编辑");
        if (result.project.compatibility.findings.length > 0) {
          setShowCompatibility(true);
        }
      } else {
        setNotice("已取消导入");
      }
    } catch (error) {
      setNotice(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const openRecentProject = async (projectId: string): Promise<void> => {
    setBusy(true);
    setNotice("正在恢复本地项目…");
    try {
      const restored = await window.sierraStudio.openProject(projectId);
      activateProject(restored);
      setNotice("项目已恢复");
    } catch (error) {
      setNotice(
        `打开项目失败：${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setBusy(false);
    }
  };

  const exportHtml = async (): Promise<void> => {
    if (!project) return;
    const result = await window.sierraStudio.exportStatic(project.projectId);
    if (!result.canceled) setNotice(`已导出到 ${result.exportPath}`);
  };

  const exportPdf = async (): Promise<void> => {
    if (!project) return;
    setPdfBusy(true);
    try {
      await coordinator.waitForIdle();
      const response = await window.sierraStudio.exportPdf({
        projectId: project.projectId,
        options: pdfOptions
      });
      if (response.error) {
        setNotice(`PDF 导出失败：${response.error}`);
        return;
      }
      if (response.canceled || !response.result) {
        setNotice("已取消 PDF 导出");
        return;
      }
      setShowPdfExport(false);
      setNotice(
        `PDF 已导出：${response.result.pages} 页${
          response.result.warnings.length > 0
            ? ` · ${response.result.warnings.length} 项分页/资源提示`
            : ""
        } · ${response.result.outputPath}`
      );
    } catch (error) {
      setNotice(
        `PDF 导出失败：${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setPdfBusy(false);
    }
  };

  const exportPptx = async (): Promise<void> => {
    if (!project) return;
    setPptxBusy(true);
    try {
      await Promise.all([
        coordinator.waitForIdle(),
        watermarkPersistenceQueueRef.current
      ]);
      const response = await window.sierraStudio.exportPptx({
        projectId: project.projectId,
        options: pptxOptions
      });
      if (response.error) {
        setNotice(`PowerPoint 导出失败：${response.error}`);
        return;
      }
      if (response.canceled || !response.result) {
        setNotice("已取消 PowerPoint 导出");
        return;
      }
      setShowPptxExport(false);
      setPptxExportSuccess({
        outputPath: response.result.outputPath,
        slides: response.result.slides,
        warnings: response.result.warnings.length
      });
      setNotice(
        `PowerPoint 已导出：${response.result.slides} 页${
          response.result.warnings.length > 0
            ? ` · ${response.result.warnings.length} 项提示`
            : ""
        } · ${response.result.outputPath}`
      );
    } catch (error) {
      setNotice(
        `PowerPoint 导出失败：${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      setPptxBusy(false);
    }
  };

  const moveHistoryOnce = async (
    direction: "undo" | "redo"
  ): Promise<void> => {
    if (!project) return;
    await Promise.all([
      coordinator.waitForIdle(),
      watermarkPersistenceQueueRef.current
    ]);
    const result = direction === "undo"
      ? await window.sierraStudio.undo(project.projectId)
      : await window.sierraStudio.redo(project.projectId);
    revisionRef.current = result.revision;
    setProject((current) => current && { ...current, revision: result.revision });
    // In-place undo/redo: ask the runtime to apply the inverse (undo) or
    // forward (redo) command to the live DOM. No iframe reload, no flicker,
    // no scroll jump, no loss of in-progress text selection.
    const command = direction === "undo" ? result.inverse : result.forward;
    if (command) {
      iframeRef.current?.contentWindow?.postMessage({
        source: "html-studio-host",
        action: "apply-command",
        payload: command
      } satisfies HostToEditorMessage, "*");
      if (command.type === "watermarks.set") {
        const features: ProjectFeatures = {
          ...project.features,
          watermarks: command.after
        };
        setProject((current) => current && { ...current, features });
        await queueWatermarkPersistence(project.projectId, features);
      }
      setNotice(direction === "undo" ? "已撤销" : "已重做");
    } else {
      setNotice(direction === "undo" ? "已撤销（到达开头）" : "已重做（到达末尾）");
    }
  };

  const moveHistory = (
    direction: "undo" | "redo"
  ): Promise<void> => {
    historyQueueRef.current = historyQueueRef.current
      .then(() => moveHistoryOnce(direction))
      .catch((error: unknown) => {
        setNotice(
          `历史操作失败：${error instanceof Error ? error.message : String(error)}`
        );
      });
    return historyQueueRef.current;
  };

  const chooseImage = async (): Promise<void> => {
    if (!project) return;
    const result = await window.sierraStudio.importImage(project.projectId);
    if (!result.canceled && result.imageSource) {
      postToEditor({ action: "image", path: result.imageSource });
    }
  };

  const chooseImages = async (): Promise<void> => {
    if (!project) return;
    if (imageSlotSelection.selected === 0) {
      setNotice("请先选择要填充的图片槽");
      return;
    }
    const result = await window.sierraStudio.importImages(project.projectId);
    if (!result.canceled && result.images?.length) {
      setPendingBatchImages(result.images.map((image, index) => ({
        id: `${Date.now()}-${index}-${image.originalName}`,
        imageSource: image.imageSource,
        originalName: image.originalName
      })));
    }
  };

  const chooseVideo = async (): Promise<void> => {
    if (!project) return;
    const result = await window.sierraStudio.importMedia(project.projectId, "video");
    if (!result.canceled && result.assetPath) {
      postToEditor({
        action: "video",
        path: result.assetPath,
        title: result.originalName ?? "视频"
      });
    }
  };

  const setStyle = (property: string, value: string): void => {
    postToEditor({
      action: "set-style",
      declarations: [{ property, value, priority: "" }]
    });
  };

  const previewStyle = (property: string, value: string): void => {
    postToEditor({
      action: "preview-style",
      declarations: [{ property, value, priority: "" }]
    });
  };

  const commitStyle = (property: string, value: string): void => {
    postToEditor({
      action: "commit-style",
      declarations: [{ property, value, priority: "" }]
    });
  };

  const align = (alignment: Alignment): void => {
    postToEditor({ action: "align", alignment });
  };

  const adjustSelectionFontSize = (delta: number): void => {
    const current = parseFloat(
      selection?.textFormat?.fontSize
      || selection?.fontSize
      || "16"
    ) || 16;
    const next = Math.min(240, Math.max(6, current + delta));
    postToEditor({
      action: "commit-text-style",
      property: "font-size",
      value: `${next}px`
    });
  };

  const selectLayer = (nodeId: string): void => {
    postToEditor({ action: "locate-node", nodeId });
  };

  const changeViewport = (width: number, height: number): void => {
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    setCanvasViewport({
      width: Math.min(7680, Math.max(240, width)),
      height: Math.min(7680, Math.max(240, height))
    });
  };

  const selectBreakpoint = (breakpoint: BreakpointDefinition): void => {
    if (!project) return;
    const features: ProjectFeatures = {
      ...project.features,
      responsive: {
        ...project.features.responsive,
        activeBreakpointId: breakpoint.id
      }
    };
    setProject((current) => current && { ...current, features });
    setCanvasViewport({
      width: breakpoint.width,
      height: breakpoint.height
    });
    void window.sierraStudio.updateProjectFeatures({
      projectId: project.projectId,
      features
    }).catch((error) => {
      setNotice(
        `断点设置保存失败：${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
  };

  const runResponsiveAudit = (): void => {
    if (!project || responsiveAuditBusy) return;
    setResponsiveAuditBusy(true);
    setNotice("正在分批检查当前画面的响应式问题…");
    postToEditor({ action: "request-responsive-audit" });
  };

  const previewResponsiveStyle = (
    property: string,
    value: string
  ): void => {
    if (!activeBreakpoint?.mediaWidth) return;
    postToEditor({
      action: "preview-responsive-style",
      breakpoint: activeBreakpoint,
      declarations: [{ property, value }]
    });
  };

  const commitResponsiveStyle = (
    property: string,
    value: string
  ): void => {
    if (!activeBreakpoint?.mediaWidth) return;
    postToEditor({
      action: "commit-responsive-style",
      breakpoint: activeBreakpoint,
      declarations: [{ property, value }]
    });
  };

  const cancelThemePreview = useCallback((): void => {
    postToEditor({ action: "cancel-theme-preview" });
  }, [postToEditor]);

  const previewTheme = useCallback((theme: ProjectTheme): void => {
    postToEditor({
      action: "preview-theme",
      css: renderThemeCss(theme),
      mode: theme.mode
    });
  }, [postToEditor]);

  const applyTheme = useCallback((theme: ProjectTheme): void => {
    if (!project) return;
    const features: ProjectFeatures = {
      ...project.features,
      theme
    };
    postToEditor({
      action: "commit-theme",
      css: renderThemeCss(theme),
      mode: theme.mode
    });
    setProject((current) => current && { ...current, features });
    void queueWatermarkPersistence(project.projectId, features).then(() => {
      setNotice("品牌主题已应用并保存");
    }).catch((error) => {
      setNotice(
        `主题设置保存失败：${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
  }, [postToEditor, project, queueWatermarkPersistence]);

  const cancelWatermarkPreview = useCallback((): void => {
    postToEditor({ action: "cancel-watermark-preview" });
  }, [postToEditor]);

  const previewWatermarks = useCallback((
    settings: WatermarkSettings
  ): void => {
    postToEditor({ action: "preview-watermarks", settings });
  }, [postToEditor]);

  const applyWatermarks = useCallback((
    settings: WatermarkSettings
  ): void => {
    if (!project) return;
    const normalized = parseWatermarkSettings(settings);
    const features: ProjectFeatures = {
      ...project.features,
      watermarks: normalized
    };
    postToEditor({ action: "commit-watermarks", settings: normalized });
    setProject((current) => current && { ...current, features });
    void queueWatermarkPersistence(project.projectId, features).then(() => {
      setNotice(`已保存 ${settings.items.length} 个全局水印`);
    }).catch((error) => {
      setNotice(
        `水印设置保存失败：${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
  }, [postToEditor, project, queueWatermarkPersistence]);

  const chooseWatermarkImage = useCallback(async (): Promise<{
    source: string;
    aspectRatio: number;
  } | null> => {
    if (!project) return null;
    const result = await window.sierraStudio.importImage(project.projectId);
    if (result.canceled || !result.imageSource) return null;
    const source = result.imageSource;
    const aspectRatio = await new Promise<number>((resolve) => {
      const image = new window.Image();
      image.onload = () => resolve(
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? image.naturalWidth / image.naturalHeight
          : 3
      );
      image.onerror = () => resolve(3);
      image.src = source;
    });
    return { source, aspectRatio };
  }, [project]);

  const searchDocument = useCallback((
    query: string,
    filter: DocumentElementFilter
  ): void => {
    postToEditor({ action: "search-document", query, filter });
  }, [postToEditor]);

  const requestLayers = useCallback((): void => {
    postToEditor({ action: "request-layers" });
  }, [postToEditor]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img src={logoUrl} className="brand-logo" alt="SierraStudio" />
          <div className="brand-copy">
            <strong>Sierra Studio</strong>
            <span className="brand-divider" />
            <small>{project?.name ?? "HTML 可视化编辑器"}</small>
          </div>
        </div>

        <div className="topbar-history" aria-label="编辑历史">
          <button
            className="icon-control"
            onClick={() => void moveHistory("undo")}
            disabled={!project}
            title="撤销（Ctrl+Z）"
            aria-label="撤销"
          >
            <Undo2 size={16} />
          </button>
          <button
            className="icon-control"
            onClick={() => void moveHistory("redo")}
            disabled={!project}
            title="重做（Ctrl+Y）"
            aria-label="重做"
          >
            <Redo2 size={16} />
          </button>
        </div>

        <div className="toolbar">
          <button className="toolbar-button subtle" onClick={importHtml} disabled={busy}>
            <FolderOpen size={15} />打开
          </button>
          <button
            className="toolbar-button subtle"
            onClick={() => {
              if (!project) return;
              setShowCodeView(true);
              postToEditor({ action: "request-source" });
            }}
            disabled={!project}
            title="查看生成的 HTML 源码"
          >
            <Code2 size={15} />查看源码
          </button>
          <button className="toolbar-button" onClick={exportHtml} disabled={!project}>
            <Download size={15} />HTML
          </button>
          <button
            className="toolbar-button"
            onClick={() => setShowPptxExport(true)}
            disabled={!project}
          >
            <Download size={15} />导出 PPTX
          </button>
          <button
            className="toolbar-button primary"
            onClick={() => setShowPdfExport(true)}
            disabled={!project}
          >
            <Download size={15} />导出 PDF
          </button>
          {cloudClient.isEnabled && (
            <span
              className={`cloud-status ${cloudSaveStatus}`}
              title={cloudSaveStatus === "saved" ? "已同步到云端" : cloudSaveStatus === "saving" ? "保存中..." : cloudSaveStatus === "error" ? "同步失败" : "等待保存"}
            >
              <Save size={14} />
            </span>
          )}
        </div>
      </header>

      {operationLabel && (
        <div className="operation-progress" aria-live="polite">
          <div className="operation-progress-copy">{operationLabel}</div>
          <div
            className="operation-progress-track"
            role="progressbar"
            aria-label={operationLabel}
          >
            <span />
          </div>
        </div>
      )}

      <section className="workspace">
        <nav className="activity-rail" aria-label="编辑器面板">
          {[
            { id: "layers", label: "图层", icon: Layers3 },
            { id: "insert", label: "插入", icon: Blocks },
            { id: "assets", label: "资源", icon: Image },
            { id: "theme", label: "品牌主题", icon: Palette },
            { id: "watermarks", label: "全局水印", icon: Stamp },
            { id: "help", label: "帮助", icon: CircleHelp }
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={leftPanel === id ? "active" : ""}
              onClick={() => {
                setLeftPanel(id as LeftPanel);
                if (id === "layers") {
                  postToEditor({
                    action: "search-document",
                    query: "",
                    filter: "all"
                  });
                  // Keep the capped legacy tree warm for keyboard users and
                  // existing project/test integrations. The searchable
                  // index remains the primary path for large documents.
                  postToEditor({ action: "request-layers" });
                }
              }}
              title={label}
              aria-label={label}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <aside className="left-panel">
          {leftPanel === "layers" && (
            project ? (
              <DocumentNavigatorPanel
                navigation={documentNavigation}
                layers={layers}
                selectedId={selection?.nodeId ?? null}
                onSearch={searchDocument}
                onLocate={selectLayer}
                onRequestLayers={requestLayers}
              />
            ) : (
              <div className="panel-empty">
                <FileCode2 size={24} />
                <strong>尚未打开文档</strong>
                <p>打开 HTML 后可搜索页面结构</p>
              </div>
            )
          )}

          {leftPanel === "insert" && (
            <>
              <div className="panel-heading">
                <div><h2>插入元素</h2><p>点击后添加到当前页面</p></div>
              </div>
              <div className="insert-placement" role="group" aria-label="插入方式">
                <button
                  className={insertPlacement === "flow" ? "active" : ""}
                  onClick={() => setInsertPlacement("flow")}
                >
                  <PanelLeft size={14} />
                  <span><strong>内容流</strong><small>嵌入原页面布局</small></span>
                </button>
                <button
                  className={insertPlacement === "free" ? "active" : ""}
                  onClick={() => setInsertPlacement("free")}
                >
                  <Move size={14} />
                  <span><strong>自由定位</strong><small>像画板对象一样摆放</small></span>
                </button>
              </div>
              <p className="insert-placement-hint">
                {insertPlacement === "flow"
                  ? "选中容器时嵌入容器；否则插入到所选元素之后。"
                  : "元素会放到当前画布区域，可自由拖动和缩放。"}
              </p>
              <div className="panel-search">
                <Blocks size={15} />
                <input
                  value={blockSearch}
                  onChange={(event) => setBlockSearch(event.target.value)}
                  placeholder="搜索元素"
                  aria-label="搜索元素"
                />
              </div>
              <div className="block-library">
                {BLOCK_GROUPS.map((group) => {
                  const items = group.items.filter((item) =>
                    `${item.label}${item.description}`.toLowerCase().includes(blockSearch.trim().toLowerCase())
                  );
                  if (items.length === 0) return null;
                  return (
                    <section className="block-group" key={group.label}>
                      <div className="section-label">{group.label}</div>
                      <div className="block-grid">
                        {items.map(({ type, label, description, icon: Icon }) => (
                          <button
                            key={type}
                            className="block-btn"
                            disabled={!project}
                            title={description}
                            onClick={() => postToEditor({
                              action: "insert-block",
                              blockType: type,
                              placement: insertPlacement
                            })}
                          >
                            <Icon size={17} strokeWidth={1.8} />
                            <span>{label}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            </>
          )}

          {leftPanel === "assets" && (
            <>
              <div className="panel-heading">
                <div><h2>资源</h2><p>导入页面使用的媒体</p></div>
              </div>
              <button className="asset-import" onClick={chooseImage} disabled={!project}>
                <span><Upload size={19} /></span>
                <div>
                  <strong>{selection?.tagName === "img" ? "替换所选图片" : "导入图片"}</strong>
                  <small>PNG、JPG、WebP、SVG</small>
                </div>
              </button>
              <button
                className={`asset-import${imageSlotSelection.active ? " active" : ""}`}
                onClick={() => postToEditor({
                  action: "select-image-slots",
                  mode: "toggle"
                })}
                disabled={!project || runtimeState !== "ready"}
              >
                <span><Image size={19} /></span>
                <div>
                  <strong>
                    {imageSlotSelection.active
                      ? `完成点选（已选 ${imageSlotSelection.selected}）`
                      : "选择图片槽"}
                  </strong>
                  <small>
                    {imageSlotSelection.candidates > 0
                      ? `识别到 ${imageSlotSelection.candidates} 个候选槽位`
                      : "Alt + 单击可随时直接多选，并按点击顺序编号"}
                  </small>
                </div>
              </button>
              <div className="image-slot-quick-actions">
                <button
                  type="button"
                  onClick={() => postToEditor({
                    action: "select-image-slots",
                    mode: "all"
                  })}
                  disabled={!project || runtimeState !== "ready"}
                >
                  识别并全选
                </button>
                <button
                  type="button"
                  onClick={() => postToEditor({
                    action: "select-image-slots",
                    mode: "clear"
                  })}
                  disabled={imageSlotSelection.selected === 0}
                >
                  清空选择
                </button>
              </div>
              <button
                className="asset-import"
                onClick={chooseImages}
                disabled={!project || imageSlotSelection.selected === 0}
              >
                <span><Image size={19} /></span>
                <div>
                  <strong>
                    批量嵌入到 {imageSlotSelection.selected} 个槽位
                  </strong>
                  <small>图片顺序对应画布上的绿色编号</small>
                </div>
              </button>
              <button className="asset-import" onClick={chooseVideo} disabled={!project}>
                <span><Video size={19} /></span>
                <div>
                  <strong>{selection?.tagName === "video" ? "替换所选视频" : "导入视频"}</strong>
                  <small>MP4、WebM、OGG、MOV</small>
                </div>
              </button>
              <div className="panel-note">
                <Image size={16} />
                <p>候选槽位包括语义容器、大尺寸内容图片、图片背景；Logo、水印、图标和 Canvas 默认排除。</p>
              </div>
            </>
          )}

          {leftPanel === "theme" && (
            <ThemePanel
              theme={project?.features.theme ?? {
                version: 1,
                name: "默认品牌",
                mode: "light",
                applyBaseStyles: false,
                tokens: []
              }}
              disabled={!project}
              onPreview={previewTheme}
              onApply={applyTheme}
              onCancelPreview={cancelThemePreview}
            />
          )}

          {leftPanel === "watermarks" && (
            <WatermarkPanel
              settings={
                parseWatermarkSettings(
                  project?.features.watermarks ?? createWatermarkSettings()
                )
              }
              candidates={watermarkCandidates}
              focusRequest={watermarkFocus}
              disabled={!project || runtimeState !== "ready"}
              onChooseImage={chooseWatermarkImage}
              onPreview={previewWatermarks}
              onApply={applyWatermarks}
              onCancelPreview={cancelWatermarkPreview}
              onRefreshCandidates={() => postToEditor({
                action: "request-watermark-candidates"
              })}
            />
          )}

          {leftPanel === "help" && (
            <>
              <div className="panel-heading">
                <div><h2>使用帮助</h2><p>画布操作与快捷键</p></div>
              </div>
              <div className="help-list">
                <section><strong>选择与编辑</strong><p>单击选择，双击编辑文字，按 Shift / Ctrl 多选。</p></section>
                <section><strong>移动与缩放</strong><p>拖动元素移动；拖动四角控制点缩放，按 Shift 保持比例。</p></section>
                <section>
                  <strong>常用快捷键</strong>
                  <dl>
                    <div><dt>撤销 / 重做</dt><dd>Ctrl+Z / Ctrl+Y</dd></div>
                    <div><dt>复制元素</dt><dd>Ctrl+D</dd></div>
                    <div><dt>删除元素</dt><dd>Delete</dd></div>
                    <div><dt>微调位置</dt><dd>方向键</dd></div>
                  </dl>
                </section>
              </div>
              <button
                className="text-button"
                onClick={async () => {
                  const api = window.sierraStudio as typeof window.sierraStudio & {
                    checkForUpdate?: () => Promise<{ updateAvailable?: boolean }>;
                  };
                  setUpdateStatus("checking");
                  try {
                    const result = await api.checkForUpdate?.();
                    setUpdateStatus(result?.updateAvailable ? "available" : "latest");
                  } catch {
                    setUpdateStatus("latest");
                  }
                }}
                disabled={updateStatus === "checking"}
              >
                <RefreshCw size={14} />
                {updateStatus === "checking" ? "正在检查…" : updateStatus === "available" ? "发现新版本" : updateStatus === "latest" ? "当前已是最新版本" : "检查更新"}
              </button>
            </>
          )}
        </aside>

        <section className="canvas-column">
          <div className="canvas-toolbar">
            {project && (
              <ResponsiveToolbar
                settings={project.features.responsive}
                viewport={canvasViewport}
                auditBusy={responsiveAuditBusy}
                onSelect={selectBreakpoint}
                onViewportChange={changeViewport}
                onRotate={() => setCanvasViewport((current) => ({
                  width: current.height,
                  height: current.width
                }))}
                onAudit={runResponsiveAudit}
              />
            )}
            <span className="canvas-toolbar-spacer" />
            {selection && (
              <div className="selection-breadcrumb">
                <Square size={12} />
                <span>{selection.count > 1 ? `${selection.count} 个元素` : selection.isComponent ? "卡片组件" : selection.tagName}</span>
              </div>
            )}
          </div>
          <section className="canvas-area">
            {project ? (
              <CanvasViewport
                documentUrl={project.documentUrl}
                projectId={project.projectId}
                reloadKey={reloadKey}
                viewportWidth={canvasViewport.width}
                viewportHeight={canvasViewport.height}
                iframeRef={iframeRef}
                runtimeState={runtimeState}
                onReload={reloadAuthoritativeDocument}
              />
            ) : (
              <div className="project-start">
                <button className="empty-state" onClick={importHtml}>
                  <span><FileCode2 size={26} /></span>
                  <strong>打开 HTML 开始设计</strong>
                  <small>导入现有页面，在可视化画布中直接编辑</small>
                </button>
                {recentProjects.length > 0 && (
                  <div className="recent-projects">
                    <div className="section-label">最近项目</div>
                    {recentProjects.slice(0, 5).map((recent) => (
                      <button key={recent.projectId} disabled={busy} onClick={() => void openRecentProject(recent.projectId)}>
                        <FileCode2 size={16} />
                        <span>{recent.name}</span>
                        <small>{recent.importedAt ? new Date(recent.importedAt).toLocaleDateString() : "本地项目"}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </section>

        <aside className="right-panel">
          <div className="inspector-heading">
            <div>
              <span className="eyebrow">检查器</span>
              <strong>
                {selection
                  ? selection.count > 1
                    ? `${selection.count} 个元素`
                    : selection.isComponent
                      ? "卡片组件"
                      : selection.tagName.toUpperCase()
                  : "页面"}
              </strong>
            </div>
            {selection && (
              <div className="inspector-actions">
                <button
                  className={selection.freeMovement ? "active" : ""}
                  onClick={() => postToEditor({ action: "toggle-free" })}
                  title={selection.freeMovement
                    ? "关闭自由移动并恢复原布局"
                    : "开启自由移动"}
                  aria-label="自由移动"
                >
                  <Move size={14} />
                </button>
                <button onClick={() => postToEditor({ action: "clone-selected" })} title="复制元素（Ctrl+D）" aria-label="复制元素">
                  <Copy size={14} />
                </button>
                <button
                  className={formatPainterActive ? "active" : ""}
                  onClick={() => postToEditor({
                    action: formatPainterActive
                      ? "format-painter-cancel"
                      : "format-painter-start"
                  })}
                  title={formatPainterActive ? "取消格式刷（Esc）" : "格式刷：复制当前元素格式"}
                  aria-label={formatPainterActive ? "取消格式刷" : "格式刷"}
                >
                  <Paintbrush size={14} />
                </button>
                <button
                  data-action="toggle-symbol"
                  className={selection.isSymbol ? "active" : ""}
                  onClick={() => postToEditor({ action: "toggle-symbol" })}
                  title={selection.isSymbol ? "取消同步组件" : "设为同步组件"}
                  aria-label={selection.isSymbol ? "取消同步组件" : "设为同步组件"}
                >
                  <Component size={14} />
                </button>
              </div>
            )}
          </div>
          <div className="inspector-tabs" role="tablist" aria-label="属性分类">
            {[
              { id: "content", label: "内容与样式" },
              { id: "styles", label: "样式库" },
              { id: "advanced", label: "高级" }
            ].map(({ id, label }) => (
              <button
                key={id}
                role="tab"
                aria-selected={inspectorTab === id}
                className={inspectorTab === id ? "active" : ""}
                onClick={() => {
                  setInspectorTab(id as InspectorTab);
                  if (id === "styles") {
                    postToEditor({ action: "request-style-presets" });
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="inspector-body">
          {selection ? (
            <>
              <div className="selection-title">
                <code>
                  {selection.count > 1
                    ? `${selection.count} 个对象`
                    : selection.isComponent ? "卡片组件" : selection.tagName}
                </code>
                <small>{selection.nodeId.slice(0, 14)}…</small>
              </div>

              {inspectorTab === "styles" && selection.styleProfile && (
                <StyleLibraryPanel
                  target={selection.styleProfile.target}
                  currentDeclarations={
                    selection.styleProfile.declarations
                  }
                  documentPresets={documentStylePresets}
                  userPresets={userStylePresets}
                  onRequestDocumentPresets={() => postToEditor({
                    action: "request-style-presets"
                  })}
                  onPreview={(declarations) => postToEditor({
                    action: "preview-style",
                    declarations
                  })}
                  onCancelPreview={() => postToEditor({
                    action: "cancel-style-preview"
                  })}
                  onApply={(declarations) => postToEditor({
                    action: "commit-style",
                    declarations
                  })}
                  onSaveUserPreset={(name) => {
                    const target = selection.styleProfile!.target;
                    setUserStylePresets((current) => [{
                      id: `user-${crypto.randomUUID()}`,
                      name,
                      category: styleCategoryForTarget(target),
                      target,
                      source: "user",
                      declarations: selection.styleProfile!.declarations
                    }, ...current]);
                    setNotice(`已保存到“我的样式”：${name}`);
                  }}
                  onDeleteUserPreset={(id) => {
                    postToEditor({ action: "cancel-style-preview" });
                    setUserStylePresets((current) =>
                      current.filter((preset) => preset.id !== id)
                    );
                  }}
                />
              )}

              {inspectorTab === "content"
                && activeBreakpoint?.mediaWidth !== undefined && (
                <BreakpointInspector
                  breakpoint={activeBreakpoint}
                  selection={selection}
                  onPreview={previewResponsiveStyle}
                  onCommit={commitResponsiveStyle}
                  onVisibility={(visible) => postToEditor({
                    action: "responsive-visibility",
                    breakpoint: activeBreakpoint,
                    visible
                  })}
                />
              )}

              {inspectorTab === "content" && (selection.chart || selection.isChartBlock) && (
                <section className="chart-editor">
                  <div className="chart-editor-heading">
                    <strong>图表</strong>
                    <span>
                      {selection.chart?.engine === "echarts"
                        ? "ECharts"
                        : selection.chart?.engine === "chartjs"
                          ? "Chart.js"
                          : selection.chart?.engine === "svg"
                            ? "SVG 静态图表"
                            : "配置"}
                    </span>
                  </div>
                  {selection.chart?.engine === "svg" ? (
                    <div className="svg-chart-status">
                      <div className="svg-chart-status-title">
                        <strong>已识别为完整图表</strong>
                        <span className={`chart-confidence ${selection.chart.conversion?.confidence ?? "low"}`}>
                          {selection.chart.conversion?.confidence === "high"
                            ? "高可信"
                            : selection.chart.conversion?.confidence === "medium"
                              ? "中可信"
                              : "静态"}
                        </span>
                      </div>
                      <p>{selection.chart.conversion?.reason}</p>
                      {selection.chart.conversion?.supported ? (
                        <>
                          <small>
                            已恢复 {selection.chart.data?.series.length ?? 0} 个系列、
                            {selection.chart.data?.labels?.length ?? 0} 个分类。转换后可编辑数据、颜色和类型。
                          </small>
                          <button
                            className="media-action primary"
                            onClick={() => postToEditor({ action: "convert-svg-chart" })}
                          >
                            转换为可编辑图表
                          </button>
                          <small>原始图表仍可通过撤销恢复，不会静默替换。</small>
                        </>
                      ) : (
                        <small>
                          可作为一个整体移动、缩放和定位；因无法确认原始数据，暂不显示数据编辑入口。
                        </small>
                      )}
                    </div>
                  ) : (
                  <>
                  {selection.chart && (
                  <>
                    <label>
                    图表标题
                    <input
                      key={`chart-title-${selection.nodeId}-${selection.chart.title}`}
                      defaultValue={selection.chart.title ?? ""}
                      onBlur={(event) => postToEditor({
                        action: "chart-patch",
                        patch: { title: event.target.value }
                      })}
                    />
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={selection.chart.legendVisible ?? true}
                      onChange={(event) => postToEditor({
                        action: "chart-patch",
                        patch: { legendVisible: event.target.checked }
                      })}
                    />
                    显示图例
                  </label>
                  <label>
                    主色
                    <input
                      type="color"
                      value={selection.chart.primaryColor ?? "#5470c6"}
                      onChange={(event) => scheduleColorCommit(
                        `chart-primary-${selection.nodeId}`,
                        {
                          action: "chart-patch",
                          patch: { primaryColor: event.target.value }
                        }
                      )}
                    />
                  </label>
                  <div className="field-row">
                    <label>
                      图表类型
                      <select
                        key={`chart-type-${selection.chart.key}`}
                        defaultValue={
                          selection.chart.data?.series[0]?.type === "pie"
                            ? "pie"
                            : selection.chart.data?.series[0]?.type === "bar"
                              ? "bar"
                              : "line"
                        }
                        onChange={(e) => {
                          const t = e.target.value as "line" | "bar" | "area" | "pie";
                          postToEditor({ action: "change-chart-type", chartType: t });
                        }}
                      >
                        <option value="line">折线</option>
                        <option value="bar">柱状</option>
                        <option value="area">面积</option>
                        <option value="pie">饼图</option>
                      </select>
                    </label>
                  </div>
                  </> )}
                  <div className="field-row">
                    <button onClick={() => postToEditor({ action: "import-csv-data" })}>
                      📊 导入 CSV
                    </button>
                    <button onClick={() => postToEditor({
                      action: "chart-patch",
                      patch: {
                        data: {
                          labels: ["一月", "二月", "三月", "四月"],
                          series: [{ name: "数据", data: [120, 200, 150, 80] }]
                        }
                      }
                    })}>
                      恢复示例数据
                    </button>
                  </div>
                  <label>
                    图表数据 JSON
                    <ChartDataJsonEditor
                      key={selection.chart?.key ?? selection.nodeId}
                      chartKey={selection.chart?.key ?? selection.nodeId}
                      data={selection.chart?.data ?? { labels: [], series: [] }}
                      onPatch={(data) => postToEditor({
                        action: "chart-patch",
                        patch: { data }
                      })}
                      onInvalid={setNotice}
                    />
                  </label>
                  <small>
                    图表配置保存在项目命令中，可撤销、恢复并用于导出。
                  </small>
                  </>
                  )}
                </section>
              )}

              {inspectorTab === "content" && selection.canEditText && (
                <label>
                  文字内容
                  <textarea
                    key={`text-${selection.nodeId}-${selection.text}`}
                    defaultValue={selection.text}
                    onInput={(event) => postToEditor({
                      action: "preview-text",
                      text: event.currentTarget.value
                    })}
                    onBlur={(event) => postToEditor({
                      action: "commit-text",
                      text: event.target.value
                    })}
                  />
                </label>
              )}

              {inspectorTab === "content"
                && selection.canEditRichText
                && !selection.canEditText && (
                <section className="rich-text-edit-card">
                  <strong>富文本内容</strong>
                  <small>
                    该文字包含加粗、链接或脚注。请在画布中编辑，以保留原有格式。
                  </small>
                  <button
                    className="media-action primary"
                    onClick={() => postToEditor({ action: "edit-selected" })}
                  >
                    在画布中编辑文字
                  </button>
                </section>
              )}

              {inspectorTab === "content" && (selection.hasTextSelection || selection.textFormat || selection.canEditText) && (
                <section className="text-style-controls">
                  <label>选区样式</label>
                  <small style={{ color: "#738196", display: "block", marginBottom: 4 }}>
                    {selection.textFormat ? "点击按钮即可应用，再次点击还原" : "双击文字进入编辑后启用"}
                  </small>
                  <div className="text-style-row">
                    <button
                      className={selection.textFormat?.bold ? "active" : ""}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => postToEditor({ action: "text-style", property: "font-weight", value: "bold" })}
                      style={{ fontWeight: "bold" }}
                      title="加粗（再次点击取消）"
                    >B</button>
                    <button
                      className={selection.textFormat?.italic ? "active" : ""}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => postToEditor({ action: "text-style", property: "font-style", value: "italic" })}
                      style={{ fontStyle: "italic" }}
                      title="斜体（再次点击取消）"
                    >I</button>
                    <button
                      className={selection.textFormat?.underline ? "active" : ""}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => postToEditor({ action: "text-style", property: "text-decoration", value: "underline" })}
                      style={{ textDecoration: "underline" }}
                      title="下划线（再次点击取消）"
                    >U</button>
                    <LiveTextColorInput
                      title="文字颜色"
                      property="color"
                      value={selection.textFormat?.foreColor}
                      fallback="#000000"
                      onPreview={(property, value) => postToEditor({
                        action: "preview-text-style",
                        property,
                        value
                      })}
                      onCommit={(property, value) => postToEditor({
                        action: "commit-text-style",
                        property,
                        value
                      })}
                    />
                    <LiveTextColorInput
                      title="背景高亮"
                      property="background-color"
                      value={selection.textFormat?.hiliteColor}
                      fallback="#ffff00"
                      onPreview={(property, value) => postToEditor({
                        action: "preview-text-style",
                        property,
                        value
                      })}
                      onCommit={(property, value) => postToEditor({
                        action: "commit-text-style",
                        property,
                        value
                      })}
                    />
                    <button
                      type="button"
                      title="缩小字号"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => adjustSelectionFontSize(-2)}
                    >
                      <Minus size={14} />
                    </button>
                    <TextFontSizeInput
                      nodeId={selection.nodeId}
                      fontSize={
                        selection.textFormat?.fontSize
                        || selection.fontSize
                      }
                      onPreview={(value) => postToEditor({
                        action: "preview-text-style",
                        property: "font-size",
                        value
                      })}
                      onCommit={(value) => postToEditor({
                        action: "commit-text-style",
                        property: "font-size",
                        value
                      })}
                    />
                    <button
                      type="button"
                      title="增大字号"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => adjustSelectionFontSize(2)}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  <button
                    className="clear-color-button"
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => postToEditor({
                      action: "text-style",
                      property: "background-color",
                      value: "transparent"
                    })}
                    title="移除所选文字的背景高亮"
                  >
                    <Minus size={13} />
                    无高亮色
                  </button>
                  <small>选中文字后可修改样式；按 Ctrl+Z 撤销</small>
                </section>
              )}

              {inspectorTab === "content" && selection.tagName === "img" && (
                <section className="image-info">
                  <button className="media-action primary" onClick={() => void chooseImage()}>
                    <Upload size={14} />
                    {selection.imageSrc ? "替换图片" : "选择图片"}
                  </button>
                  <label>
                    图片源
                    <input
                      type="text"
                      readOnly
                      value={selection.imageSrc ?? ""}
                      title={selection.imageSrc ?? ""}
                      style={{ cursor: "default" }}
                    />
                  </label>
                  <small>
                    图片会以 Base64 直接内嵌到 HTML；拖动四角控制点缩放，按 Shift 保持比例。
                  </small>
                </section>
              )}

              {inspectorTab === "content" && selection.tagName === "video" && (
                <section className="image-info">
                  <button className="media-action primary" onClick={() => void chooseVideo()}>
                    <Upload size={14} />
                    {selection.videoSrc ? "替换视频" : "选择本地视频"}
                  </button>
                  <label>
                    视频源
                    <input
                      type="text"
                      readOnly
                      value={selection.videoSrc ?? ""}
                      title={selection.videoSrc ?? ""}
                    />
                  </label>
                  <div className="field-row">
                    <label className="checkbox-field">
                      <input
                        type="checkbox"
                        defaultChecked
                        onChange={(event) => postToEditor({
                          action: "set-attribute",
                          name: "controls",
                          value: event.target.checked ? "controls" : ""
                        })}
                      />
                      显示控制栏
                    </label>
                    <label className="checkbox-field">
                      <input
                        type="checkbox"
                        onChange={(event) => postToEditor({
                          action: "set-attribute",
                          name: "loop",
                          value: event.target.checked ? "loop" : ""
                        })}
                      />
                      循环播放
                    </label>
                  </div>
                  <small>支持 MP4、WebM、OGG 和 MOV；文件会随项目一起导出。</small>
                </section>
              )}

              {inspectorTab === "content" && (
              <>
              <section className="free-movement-control">
                <div>
                  <strong>自由移动</strong>
                  <small>
                    {selection.freeMovement
                      ? "已脱离原文档流，可拖动、微调和改变叠放层级"
                      : "开启后保留当前位置；关闭时恢复原布局样式"}
                  </small>
                </div>
                <label className="switch-field">
                  <input
                    type="checkbox"
                    checked={selection.freeMovement === true}
                    onChange={() => postToEditor({ action: "toggle-free" })}
                  />
                  <span aria-hidden="true" />
                </label>
              </section>

              <label>
                多选对齐
                <div className="align-grid">
                  <button title="对齐所选对象的左边缘" onClick={() => align("left")} disabled={selection.count < 2}>左边缘</button>
                  <button title="对齐所选对象的水平中心" onClick={() => align("center")} disabled={selection.count < 2}>水平中</button>
                  <button title="对齐所选对象的右边缘" onClick={() => align("right")} disabled={selection.count < 2}>右边缘</button>
                  <button title="对齐所选对象的上边缘" onClick={() => align("top")} disabled={selection.count < 2}>上边缘</button>
                  <button title="对齐所选对象的垂直中心" onClick={() => align("middle")} disabled={selection.count < 2}>垂直中</button>
                  <button title="对齐所选对象的下边缘" onClick={() => align("bottom")} disabled={selection.count < 2}>下边缘</button>
                </div>
                <small>
                  以选区边界对齐，可能使对象重叠；仅支持同一容器中的同级对象。
                </small>
              </label>

              <div className="field-row">
                <label>
                  宽度
                  <input
                    key={`width-${selection.nodeId}-${selection.width}`}
                    type="number"
                    min="12"
                    defaultValue={selection.width}
                    onInput={(event) => previewStyle("width", event.currentTarget.value ? `${event.currentTarget.value}px` : "")}
                    onBlur={(event) => commitStyle("width", event.currentTarget.value ? `${event.currentTarget.value}px` : "")}
                  />
                </label>
                <label>
                  高度
                  <input
                    key={`height-${selection.nodeId}-${selection.height}`}
                    type="number"
                    min="12"
                    defaultValue={selection.height}
                    onInput={(event) => previewStyle("height", event.currentTarget.value ? `${event.currentTarget.value}px` : "")}
                    onBlur={(event) => commitStyle("height", event.currentTarget.value ? `${event.currentTarget.value}px` : "")}
                  />
                </label>
              </div>

              <label>
                文字对齐
                <div className="segmented">
                  <button onClick={() => setStyle("text-align", "left")}>左</button>
                  <button onClick={() => setStyle("text-align", "center")}>中</button>
                  <button onClick={() => setStyle("text-align", "right")}>右</button>
                </div>
              </label>

              <div className="field-row">
                <label>
                  字号
                  <input
                    key={`font-size-${selection.nodeId}-${selection.fontSize}`}
                    type="number"
                    min="6"
                    max="240"
                    defaultValue={parseFloat(selection.fontSize) || 16}
                    onInput={(event) => previewStyle("font-size", event.currentTarget.value ? `${event.currentTarget.value}px` : "")}
                    onBlur={(event) => commitStyle("font-size", event.currentTarget.value ? `${event.currentTarget.value}px` : "")}
                  />
                </label>
                <label>
                  圆角
                  <input
                    key={`border-radius-${selection.nodeId}-${selection.borderRadius ?? "0"}`}
                    type="number"
                    min="0"
                    defaultValue={
                      parseFloat(selection.borderRadius ?? "0") || 0
                    }
                    onInput={(event) => previewStyle("border-radius", event.currentTarget.value ? `${event.currentTarget.value}px` : "")}
                    onBlur={(event) => commitStyle("border-radius", event.currentTarget.value ? `${event.currentTarget.value}px` : "")}
                  />
                </label>
              </div>

              <label>
                背景色
                <div className="color-control">
                  <input
                    type="color"
                    defaultValue={selection.backgroundColor || "#ffffff"}
                    onInput={(event) => previewStyle("background-color", event.currentTarget.value)}
                    onChange={(event) => scheduleColorCommit(
                      `element-background-${selection.nodeId}`,
                      {
                        action: "commit-style",
                        declarations: [{
                          property: "background-color",
                          value: event.target.value,
                          priority: ""
                        }]
                      }
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      previewStyle("background-color", "");
                      scheduleColorCommit(
                        `element-background-${selection.nodeId}`,
                        {
                          action: "commit-style",
                          declarations: [{
                            property: "background-color",
                            value: "",
                            priority: ""
                          }]
                        }
                      );
                    }}
                    title="移除背景色，恢复页面原有样式"
                  >
                    <Minus size={14} />
                    无颜色
                  </button>
                </div>
              </label>

              <dl>
                <div><dt>定位模式</dt><dd>{selection.position}</dd></div>
                <div><dt>已选对象</dt><dd>{selection.count}</dd></div>
              </dl>
              <p className="hint">
                {selection.count > 1
                  ? "对齐会自动把同一容器里的对象转换为自由定位。"
                  : "双击文字或在文字框修改；拖动四角蓝点缩放，按 Shift 等比缩放。"}
              </p>
              </>
              )}

              {/* --- Trait Manager (GrapesJS traits) --- */}
              {inspectorTab === "advanced" && (
              <>
              <ReusableComponentPanel
                component={selection.component}
                onCreate={(name) => postToEditor({
                  action: "component-create",
                  name
                })}
                onDuplicate={() => postToEditor({
                  action: "component-duplicate"
                })}
                onDetach={() => postToEditor({
                  action: "component-detach"
                })}
                onResetField={() => postToEditor({
                  action: "component-reset-field"
                })}
              />
              <label>属性编辑</label>
              {selection.tagName === "img" && (
                <>
                  <label>
                    src
                    <input
                      key={`img-src-${selection.nodeId}`}
                      type="text"
                      defaultValue={selection.imageSrc ?? ""}
                      onBlur={(e) => postToEditor({ action: "set-attribute", name: "src", value: e.target.value })}
                    />
                  </label>
                  <label>
                    alt
                    <input
                      type="text"
                      defaultValue=""
                      onBlur={(e) => postToEditor({ action: "set-attribute", name: "alt", value: e.target.value })}
                    />
                  </label>
                </>
              )}
              {selection.tagName === "a" && (
                <label>
                  href
                  <input
                    type="text"
                    defaultValue=""
                    onBlur={(e) => postToEditor({ action: "set-attribute", name: "href", value: e.target.value })}
                  />
                </label>
              )}

              <label>位置微调</label>
              <div className="position-nudge-grid">
                <button
                  disabled={!selection.freeMovement}
                  onClick={() => postToEditor({ action: "nudge", dx: 0, dy: -10 })}
                >↑ 上移 10px</button>
                <button
                  disabled={!selection.freeMovement}
                  onClick={() => postToEditor({ action: "nudge", dx: 0, dy: 10 })}
                >↓ 下移 10px</button>
                <button
                  disabled={!selection.freeMovement}
                  onClick={() => postToEditor({ action: "nudge", dx: -10, dy: 0 })}
                >← 左移 10px</button>
                <button
                  disabled={!selection.freeMovement}
                  onClick={() => postToEditor({ action: "nudge", dx: 10, dy: 0 })}
                >→ 右移 10px</button>
              </div>
              {!selection.freeMovement && (
                <small>先开启“自由移动”后才能微调位置。</small>
              )}

              <label>叠放层级 · 当前 {selection.zIndex ?? 0}</label>
              <div className="field-row z-index-controls">
                <button
                  disabled={!selection.freeMovement}
                  onClick={() => postToEditor({ action: "adjust-zindex", delta: 10 })}
                >前移 Ctrl+]</button>
                <button
                  disabled={!selection.freeMovement}
                  onClick={() => postToEditor({ action: "adjust-zindex", delta: -10 })}
                >后移 Ctrl+[</button>
              </div>

              {/* --- Clone button --- */}
              <button
                onClick={() => postToEditor({ action: "clone-selected" })}
                style={{ marginTop: 8 }}
              >克隆 Ctrl+D</button>

              {/* --- Symbol toggle (GrapesJS Symbols) --- */}
              <button
                onClick={() => postToEditor({ action: "toggle-symbol" })}
                style={{ marginTop: 4 }}
              >
                {selection.isSymbol ? "取消符号标记" : "标记为符号"}
              </button>
              {selection.isSymbol && (
                <small style={{ color: "#738196", display: "block", marginTop: 4 }}>
                  符号: {selection.symbolId?.slice(0,18)}… 编辑一处，全文档同步
                </small>
              )}

              {/* --- Enhanced Property Panel --- */}
              <label style={{ marginTop: 8 }}>属性</label>
              <label>
                ID
                <input key={`prop-id-${selection.nodeId}`} type="text" defaultValue={selection.nodeId.slice(0,24)} readOnly style={{ opacity: 0.6 }} />
              </label>
              <label>
                类名 (class)
                <input type="text" defaultValue="" placeholder="如: highlight" onBlur={(e) => postToEditor({ action: "set-attribute", name: "class", value: e.target.value })} />
              </label>
              <label>
                提示 (title)
                <input type="text" defaultValue="" placeholder="悬停提示文字" onBlur={(e) => postToEditor({ action: "set-attribute", name: "title", value: e.target.value })} />
              </label>

              <label>快捷键</label>
              <small style={{ color: "#738196", lineHeight: 1.8 }}>
                Ctrl+Z 撤销 · Ctrl+Y 重做 · Ctrl+D 克隆<br/>
                Ctrl+C/V 复制粘贴 · Del 删除<br/>
                Ctrl+] / [ 层级 · Enter 编辑<br/>
                Tab 下个元素 · 方向键微移<br/>
                Shift+方向 快速移动 · Ctrl+A 全选容器
              </small>
              </>
              )}
            </>
          ) : (
            <div className="panel-empty">
              <Square size={22} />
              <strong>选择画布中的元素</strong>
              <p>选中后可编辑内容、样式和高级属性。</p>
            </div>
          )}
          </div>
        </aside>
      </section>

      {responsiveAudit && (
        <ResponsiveAuditPanel
          report={responsiveAudit.report}
          importedMediaQueries={responsiveAudit.importedMediaQueries}
          onLocate={(nodeId) => {
            selectLayer(nodeId);
            setResponsiveAudit(null);
          }}
          onClose={() => setResponsiveAudit(null)}
        />
      )}

      {contextMenu && (
        <>
          <div
            className="context-overlay"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => {
                postToEditor({ action: "request-copy" });
                setContextMenu(null);
              }}
            >
              复制 Ctrl+C
            </button>
            <button
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  postToEditor({ action: "paste", clipboardData: text });
                } catch {
                  setNotice("无法读取剪贴板");
                }
                setContextMenu(null);
              }}
            >
              粘贴 Ctrl+V
            </button>
            <hr />
            <button
              className="danger"
              onClick={() => {
                postToEditor({ action: "call-delete" });
                setContextMenu(null);
              }}
            >
              删除 Del
            </button>
          </div>
        </>
      )}

      <footer className="statusbar">
        <span className="status-dot" /><span>{notice}</span>
        <span className="status-spacer" />
        {project && (
          <button
            className={`compatibility-status ${project.compatibility.level}`}
            onClick={() => setShowCompatibility(true)}
            title="查看导入兼容性报告"
          >
            {project.compatibility.level === "good"
              ? <ShieldCheck size={12} />
              : <AlertTriangle size={12} />}
            {project.compatibility.level === "good"
              ? "兼容良好"
              : project.compatibility.level === "partial"
                ? "部分兼容"
                : "兼容受限"}
          </button>
        )}
        <span>{project ? `版本 ${project.revision}` : "本地编辑"}</span>
        <span>·</span>
        <span>{runtimeState === "ready" ? "画布已连接" : runtimeState === "error" ? "画布连接异常" : "正在连接画布"}</span>
      </footer>

      {showCompatibility && project && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setShowCompatibility(false)}
        >
          <section
            className="pdf-dialog compatibility-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-heading">
              <div>
                <h2>导入兼容性报告</h2>
                <p>
                  {project.compatibility.mode === "static"
                    ? "静态页面"
                    : project.compatibility.mode === "dynamic-report"
                      ? "动态报告"
                      : "Web 应用"}
                  {" · "}
                  {project.compatibility.metrics.elements} 个元素
                  {" · "}
                  {project.compatibility.metrics.scripts} 段脚本
                </p>
              </div>
              <button
                className="icon-button"
                onClick={() => setShowCompatibility(false)}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <div className="compatibility-summary">
              <div>
                <strong>{project.compatibility.metrics.remoteAssets}</strong>
                <span>远程资源</span>
              </div>
              <div>
                <strong>{project.compatibility.metrics.dynamicRenderers}</strong>
                <span>动态渲染点</span>
              </div>
              <div>
                <strong>
                  {project.compatibility.detectedDependencies.length}
                </strong>
                <span>已识别依赖</span>
              </div>
            </div>
            <div className="compatibility-findings">
              {project.compatibility.findings.length === 0 ? (
                <div className="compatibility-empty">
                  <ShieldCheck size={18} />
                  未发现影响编辑或导出的兼容问题。
                </div>
              ) : project.compatibility.findings.map((finding) => (
                <article
                  key={`${finding.code}-${finding.title}`}
                  className={`compatibility-finding ${finding.severity}`}
                >
                  <span className="finding-mark" />
                  <div>
                    <strong>
                      {finding.title}
                      {finding.count ? ` · ${finding.count}` : ""}
                    </strong>
                    <p>{finding.detail}</p>
                  </div>
                </article>
              ))}
            </div>
            <div className="dialog-actions">
              {project.compatibility.mode !== "static" && (
                <button
                  onClick={() => {
                    postToEditor({ action: "materialize-document" });
                  }}
                  disabled={busy || runtimeState !== "ready"}
                >
                  {busy ? "正在物化…" : "物化为静态副本"}
                </button>
              )}
              <button
                className="primary"
                onClick={() => setShowCompatibility(false)}
              >
                继续编辑
              </button>
            </div>
          </section>
        </div>
      )}

      {pendingBatchImages && (
        <ImageOrderDialog
          images={pendingBatchImages}
          slotCount={imageSlotSelection.selected}
          onChange={setPendingBatchImages}
          onCancel={() => setPendingBatchImages(null)}
          onReselect={() => void chooseImages()}
          onConfirm={() => {
            postToEditor({
              action: "images",
              images: pendingBatchImages.map((image) => ({
                path: image.imageSource,
                title: image.originalName
              }))
            });
            setPendingBatchImages(null);
          }}
        />
      )}

      {showPdfExport && (
        <div className="modal-backdrop" role="presentation">
          <section className="pdf-dialog" role="dialog" aria-modal="true">
            <div className="dialog-heading">
              <div>
                <h2>导出 PDF</h2>
                <p>从当前已保存的编辑版本生成矢量 PDF。</p>
              </div>
              <button
                className="icon-button"
                onClick={() => setShowPdfExport(false)}
                disabled={pdfBusy}
                aria-label="关闭"
              >
                ×
              </button>
            </div>

            <div className="mode-cards">
              <button
                className={pdfOptions.mode === "long" ? "selected" : ""}
                onClick={() => setPdfOptions((current) => ({
                  ...current,
                  mode: "long"
                }))}
              >
                <strong>一整页 PDF</strong>
                <small>保留完整长页面，适合长图报告与连续阅读。</small>
              </button>
              <button
                className={pdfOptions.mode === "smart" ? "selected" : ""}
                onClick={() => setPdfOptions((current) => ({
                  ...current,
                  mode: "smart"
                }))}
              >
                <strong>智能分页 PDF</strong>
                <small>识别页面、标题、卡片和表格，避开内容中部切断。</small>
              </button>
            </div>

            <div className="pdf-fields">
              <label>
                渲染宽度
                <input
                  type="number"
                  min="320"
                  max="3840"
                  value={pdfOptions.viewportWidth}
                  onChange={(event) => setPdfOptions((current) => ({
                    ...current,
                    viewportWidth: Number(event.target.value)
                  }))}
                />
                <small>默认 1440px；页面变成手机版时可提高此值。</small>
              </label>
              <label>
                初始视口高度
                <input
                  type="number"
                  min="320"
                  max="2160"
                  value={pdfOptions.viewportHeight}
                  onChange={(event) => setPdfOptions((current) => ({
                    ...current,
                    viewportHeight: Number(event.target.value)
                  }))}
                />
              </label>
              {pdfOptions.mode === "smart" && (
                <label>
                  目标分页高度
                  <input
                    type="number"
                    min="320"
                    max="4000"
                    value={pdfOptions.targetPageHeight}
                    onChange={(event) => setPdfOptions((current) => ({
                      ...current,
                      targetPageHeight: Number(event.target.value)
                    }))}
                  />
                  <small>这是分页目标，不会给较短页面补白边。</small>
                </label>
              )}
            </div>

            <div className="dialog-actions">
              <button
                onClick={() => setShowPdfExport(false)}
                disabled={pdfBusy}
              >
                取消
              </button>
              <button
                className="primary"
                onClick={() => void exportPdf()}
                disabled={pdfBusy}
              >
                {pdfBusy ? "正在生成…" : "选择位置并导出"}
              </button>
            </div>
          </section>
        </div>
      )}

      {showPptxExport && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="pdf-dialog pptx-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pptx-export-title"
          >
            <div className="dialog-heading">
              <div>
                <h2 id="pptx-export-title">导出 PowerPoint</h2>
                <p>
                  自动识别页面与内容层级；复杂视觉效果会智能降级以保证还原度。
                </p>
              </div>
              <button
                className="icon-button"
                onClick={() => setShowPptxExport(false)}
                disabled={pptxBusy}
                aria-label="关闭"
              >
                ×
              </button>
            </div>

            <div className="mode-cards">
              <button
                className={pptxOptions.mode === "hybrid" ? "selected" : ""}
                onClick={() => setPptxOptions((current) => ({
                  ...current,
                  mode: "hybrid"
                }))}
              >
                <strong>智能混合（推荐）</strong>
                <small>
                  文字和简单对象可编辑；复杂图表、渐变与裁切效果按区域高清保真。
                </small>
              </button>
              <button
                className={pptxOptions.mode === "editable" ? "selected" : ""}
                onClick={() => setPptxOptions((current) => ({
                  ...current,
                  mode: "editable"
                }))}
              >
                <strong>完全可编辑</strong>
                <small>
                  尽量拆分全部对象，适合后续大幅修改，但复杂 CSS 可能发生视觉变化。
                </small>
              </button>
              <button
                className={pptxOptions.mode === "fidelity" ? "selected" : ""}
                onClick={() => setPptxOptions((current) => ({
                  ...current,
                  mode: "fidelity"
                }))}
              >
                <strong>高清还原</strong>
                <small>
                  每页以高清画面写入 PPTX，视觉最稳定，但页面内容不可单独编辑。
                </small>
              </button>
            </div>

            <div className="pdf-fields">
              <label>
                渲染宽度
                <input
                  type="number"
                  min="320"
                  max="3840"
                  value={pptxOptions.viewportWidth}
                  onChange={(event) => setPptxOptions((current) => ({
                    ...current,
                    viewportWidth: Number(event.target.value)
                  }))}
                />
                <small>建议保持与当前画布宽度一致，默认 1440px。</small>
              </label>
              <label>
                渲染高度
                <input
                  type="number"
                  min="320"
                  max="2160"
                  value={pptxOptions.viewportHeight}
                  onChange={(event) => setPptxOptions((current) => ({
                    ...current,
                    viewportHeight: Number(event.target.value)
                  }))}
                />
              </label>
              <label>
                幻灯片比例
                <select
                  value={`${pptxOptions.slideWidth}:${pptxOptions.slideHeight}`}
                  onChange={(event) => {
                    const [slideWidth, slideHeight] = event.target.value
                      .split(":")
                      .map(Number);
                    if (!slideWidth || !slideHeight) return;
                    setPptxOptions((current) => ({
                      ...current,
                      slideWidth,
                      slideHeight
                    }));
                  }}
                >
                  <option value="13.333:7.5">宽屏 16:9</option>
                  <option value="10:7.5">标准 4:3</option>
                  <option value="7.5:10">竖版 3:4</option>
                </select>
              </label>
            </div>

            <div className="pptx-export-note">
              <strong>复杂页面建议</strong>
              <span>
                含复杂渐变、CSS 图表、伪元素或裁切效果时优先选择“智能混合”。
                如只要求视觉一致，选择“高清还原”。
              </span>
            </div>

            <div className="dialog-actions">
              <button
                onClick={() => setShowPptxExport(false)}
                disabled={pptxBusy}
              >
                取消
              </button>
              <button
                className="primary"
                onClick={() => void exportPptx()}
                disabled={pptxBusy}
              >
                {pptxBusy ? "正在生成…" : "选择位置并导出"}
              </button>
            </div>
          </section>
        </div>
      )}

      {pptxExportSuccess && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="pdf-dialog export-success-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pptx-export-success-title"
          >
            <div className="dialog-heading">
              <div>
                <h2 id="pptx-export-success-title">导出成功</h2>
                <p>
                  PowerPoint 已成功导出，共 {pptxExportSuccess.slides} 页
                  {pptxExportSuccess.warnings > 0
                    ? `，另有 ${pptxExportSuccess.warnings} 项兼容提示`
                    : ""}。
                </p>
              </div>
            </div>
            <div className="export-success-path">
              {pptxExportSuccess.outputPath}
            </div>
            <div className="dialog-actions">
              <button
                className="primary"
                onClick={() => setPptxExportSuccess(null)}
                autoFocus
              >
                完成
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Phase 9: Floating inline text toolbar (GrapesJS/Google Docs style) */}
      {floatToolbar && (
        <div
          className="float-toolbar"
          style={{
            position: "fixed",
            left: floatToolbar.x,
            top: floatToolbar.y,
            transform: "translate(-50%, -100%)",
            zIndex: 9998,
            display: "flex",
            gap: 4,
            padding: "4px 6px",
            background: "#2a2e3a",
            border: "1px solid #4f7cff40",
            borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {[
            ["B", "font-weight", "bold"],
            ["I", "font-style", "italic"],
            ["U", "text-decoration", "underline"],
          ].map(([label, prop, val]) => (
            <button
              key={label}
              className={`float-btn${
                selection?.textFormat?.[val as keyof typeof selection.textFormat] ? " active" : ""
              }`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => postToEditor({ action: "text-style", property: prop as string, value: val as string })}
              style={{
                width: 28, height: 26, fontSize: 13, fontWeight: label === "B" ? "bold" : "normal",
                fontStyle: label === "I" ? "italic" : "normal",
                textDecoration: label === "U" ? "underline" : "none",
                background: selection?.textFormat?.[val as keyof typeof selection.textFormat] ? "#4f7cff" : "transparent",
                color: selection?.textFormat?.[val as keyof typeof selection.textFormat] ? "#fff" : "#c8d1e0",
                border: "none", borderRadius: 4, cursor: "pointer"
              }}
            >{label}</button>
          ))}
          <LiveTextColorInput
            title="文字颜色"
            property="color"
            value={selection?.textFormat?.foreColor}
            fallback="#000000"
            onPreview={(property, value) => postToEditor({
              action: "preview-text-style",
              property,
              value
            })}
            onCommit={(property, value) => postToEditor({
              action: "commit-text-style",
              property,
              value
            })}
            style={{ width: 24, height: 24, border: "none", background: "transparent", cursor: "pointer" }}
          />
        </div>
      )}

      {/* Phase 7: Code View modal */}
      {showCodeView && (
        <div className="modal-backdrop" onClick={() => setShowCodeView(false)}>
          <div className="modal code-modal" onClick={(e) => e.stopPropagation()}>
            <h3>HTML 源码</h3>
            <textarea
              className="code-editor"
              value={codeContent}
              onChange={(e) => setCodeContent(e.target.value)}
              spellCheck={false}
            />
            <div className="modal-actions">
              <button onClick={() => setShowCodeView(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
