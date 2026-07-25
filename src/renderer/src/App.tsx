import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { ChartDataSchema } from "../../domain/charts/chart-types";
import { CanvasViewport } from "./editor/CanvasViewport";
import { LayerTree } from "./editor/LayerTree";
import logoUrl from "./assets/logo.png";
import { cloudClient } from "./editor/cloud-client";

interface ProjectState {
  projectId: string;
  documentId: string;
  revision: number;
  documentUrl: string;
  name: string;
  warnings: string[];
}

type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom";

export function App(): React.JSX.Element {
  const [project, setProject] = useState<ProjectState | null>(null);
  const [selection, setSelection] = useState<SelectionSnapshot | null>(null);
  const [notice, setNotice] = useState("打开一个 HTML 文件开始编辑");
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [showPdfExport, setShowPdfExport] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    nodeId: string;
    x: number;
    y: number;
  } | null>(null);
  const [layers, setLayers] = useState<LayerNode[]>([]);
  const [showLayers, setShowLayers] = useState(false);
  const [showCodeView, setShowCodeView] = useState(false);
  const [codeContent, setCodeContent] = useState("");
  const [floatToolbar, setFloatToolbar] = useState<{ x: number; y: number } | null>(null);
  const [runtimeState, setRuntimeState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [cloudFileId, setCloudFileId] = useState<string | null>(null);
  const [cloudSaveStatus, setCloudSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [updateStatus, setUpdateStatus] = useState<"checking" | "available" | "downloading" | "downloaded" | null>(null);
  const [showCloudPanel, setShowCloudPanel] = useState(false);
  const [pdfOptions, setPdfOptions] = useState<PdfExportOptions>({
    mode: "smart",
    viewportWidth: 1440,
    viewportHeight: 900,
    targetPageHeight: 900
  });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const runtimeProbeRef = useRef<number | null>(null);
  const runtimeTimeoutRef = useRef<number | null>(null);
  const revisionRef = useRef(0);
  const editorStateRef = useRef<EditorState | null>(null);
  const cloudDebounceRef = useRef<number | null>(null);
  const lastCommandRef = useRef<CommandPayload | null>(null);
  const cloudFileIdRef = useRef<string | null>(null);
  // Throttle refs removed during debugging

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
      if (event.key === "z" && ctrl && event.shiftKey) {
        event.preventDefault();
        void moveHistory("redo");
        return;
      }
      if ((event.key === "z" && ctrl) || (event.key === "Z" && ctrl && event.shiftKey)) {
        event.preventDefault();
        void moveHistory("undo");
        return;
      }
      if ((event.key === "y" || event.key === "Y") && ctrl) {
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
      // Don't reload the entire iframe on command failure — it's too
      // destructive. Just show the error so the user can try again or
      // undo the change. The runtime's live DOM is still intact.
      setNotice(
        `保存失败：${error instanceof Error ? error.message : String(error)}`
      );
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
      if (message.type === "source-code") {
        setCodeContent(message.html);
      }
      if (message.type === "text-select-pos") {
        // Throttle: fires on every mouse move over text selection → 60 updates/sec
        // TEMPORARILY DISABLED to debug first-click color picker freeze
        // const now = performance.now();
        // if (now - toolbarThrottleRef.current < 50) return;
        // toolbarThrottleRef.current = now;
        setFloatToolbar(message.visible ? { x: message.x, y: message.y } : null);
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
  }, [commit]);

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
    setNotice("正在读取并导入 HTML…");
    try {
      const result = await window.sierraStudio.importHtml();
      if (result.error) {
        setNotice(`导入失败：${result.error}`);
        return;
      }
      if (!result.canceled && result.project) {
        revisionRef.current = result.project.revision;
        setProject(result.project);
        setSelection(null);
        setReloadKey(0);
        setNotice(result.project.warnings.length > 0
          ? `已导入，有 ${result.project.warnings.length} 项资源或格式警告`
          : "已导入；单击对象开始编辑");
      } else {
        setNotice("已取消导入");
      }
    } catch (error) {
      setNotice(`导入失败：${error instanceof Error ? error.message : String(error)}`);
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
    setNotice(
      pdfOptions.mode === "smart"
        ? "正在分析结构并生成智能分页 PDF…"
        : "正在生成单页长图 PDF…"
    );
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

  const moveHistory = async (direction: "undo" | "redo"): Promise<void> => {
    if (!project) return;
    await coordinator.waitForIdle();
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
      setNotice(direction === "undo" ? "已撤销" : "已重做");
    } else {
      setNotice(direction === "undo" ? "已撤销（到达开头）" : "已重做（到达末尾）");
    }
  };

  const chooseImage = async (): Promise<void> => {
    if (!project) return;
    const result = await window.sierraStudio.importImage(project.projectId);
    if (!result.canceled && result.assetPath) {
      postToEditor({ action: "image", path: result.assetPath });
    }
  };

  const setStyle = (property: string, value: string): void => {
    postToEditor({
      action: "set-style",
      declarations: [{ property, value, priority: "" }]
    });
  };

  const align = (alignment: Alignment): void => {
    postToEditor({ action: "align", alignment });
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img src={logoUrl} className="brand-logo" alt="SierraStudio" />
          <div>
            <strong>SierraStudio</strong>
            <small>{project?.name ?? "HTML 可视化编辑器"}</small>
          </div>
        </div>
        <div className="toolbar">
          <button onClick={importHtml} disabled={busy}>打开 HTML</button>
          <button onClick={chooseImage} disabled={!project}>插入 / 替换图片</button>
          <button onClick={() => void moveHistory("undo")} disabled={!project}>撤销</button>
          <button onClick={() => void moveHistory("redo")} disabled={!project}>重做</button>
          <button
            onClick={() => postToEditor({ action: "convert-free" })}
            disabled={!selection}
            title="转换后可像 PPT 对象一样拖动"
          >
            自由移动
          </button>
          <button onClick={exportHtml} disabled={!project}>导出 HTML</button>
          <button onClick={() => {
            if (!project) return;
            setShowCodeView(true);
            postToEditor({ action: "request-source" });
          }} disabled={!project}>源码</button>
          <button
            className="primary"
            onClick={() => setShowPdfExport(true)}
            disabled={!project}
          >
            导出 PDF
          </button>
          {/* Cloud status */}
          {cloudClient.isEnabled && (
            <span
              className={`cloud-status ${cloudSaveStatus}`}
              title={cloudSaveStatus === "saved" ? "已同步到云端" : cloudSaveStatus === "saving" ? "保存中..." : cloudSaveStatus === "error" ? "同步失败" : "等待保存"}
              style={{ fontSize: "0.8rem", color: cloudSaveStatus === "saved" ? "#4caf50" : cloudSaveStatus === "error" ? "#f44336" : "#888", marginLeft: 8 }}
            >
              {cloudSaveStatus === "saved" ? "☁️" : cloudSaveStatus === "saving" ? "⏳" : cloudSaveStatus === "error" ? "⚠️" : "☁️"}
            </span>
          )}
          {/* Auto-update check */}
          <button
            onClick={async () => {
              const api = window.sierraStudio as any;
              if (!api?.checkForUpdate) return;
              setUpdateStatus("checking");
              try {
                const result = await api.checkForUpdate();
                if (result?.updateAvailable) {
                  setUpdateStatus("available");
                  alert("发现新版本！请重新下载安装。");
                } else {
                  setUpdateStatus(null);
                }
              } catch {
                setUpdateStatus(null);
              }
            }}
            disabled={updateStatus === "checking" || updateStatus === "downloading"}
            title="检查更新"
            style={{ marginLeft: 8, opacity: updateStatus === "checking" ? 0.6 : 1 }}
          >
            {updateStatus === "checking" ? "检查中..." : updateStatus === "available" ? "🔄 更新可用" : "更新"}
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="left-panel">
          <h2>文档</h2>
          {project ? (
            <div className="document-card active">
              <span className="file-icon">&lt;/&gt;</span>
              <div><strong>index.html</strong><small>Revision {project.revision}</small></div>
            </div>
          ) : <p className="muted">尚未打开项目</p>}

          {/* GrapesJS BlockManager — 点击插入组件到画布 */}
          <h2 style={{ marginTop: 12 }}>组件</h2>
          <small style={{ color: "#738196", display: "block", marginBottom: 6 }}>
            点击按钮将组件添加到画布中
          </small>
          <div className="block-grid">
            {[
              ["h1","标题一","大标题"],
              ["h2","标题二","中标题"],
              ["h3","标题三","小标题"],
              ["p","段落","正文文字"],
              ["card","卡片","带边框容器"],
              ["img","图片","图片占位"],
              ["video","视频","视频占位"],
              ["chart","图表","数据图表区"],
              ["separator","分隔线","水平分隔"],
              ["button","按钮","操作按钮"]
            ].map(([type, label, desc]) => (
              <button
                key={type}
                className="block-btn"
                disabled={!project}
                title={desc}
                onClick={() => postToEditor({ action: "insert-block", blockType: type as string })}
              >{label}</button>
            ))}
          </div>

          <div className="safety-card">
            <strong>操作方式</strong>
            <p>
              单击选择对象；双击文字直接编辑；Shift/Ctrl 多选；卡片默认换位；
              点击“自由移动”后可任意拖动；右下角蓝点可缩放。
            </p>
          </div>
          <div className="viewport-settings">
            <strong>画布 / PDF 尺寸</strong>
            <div>
              <label>
                宽
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
              </label>
              <label>
                高
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
            </div>
            <small>画布使用真实浏览器宽度，仅在编辑器中等比缩放显示。</small>
          </div>
        </aside>

        <section className="canvas-area">
          {project ? (
            <CanvasViewport
              documentUrl={project.documentUrl}
              projectId={project.projectId}
              reloadKey={reloadKey}
              viewportWidth={pdfOptions.viewportWidth}
              viewportHeight={pdfOptions.viewportHeight}
              iframeRef={iframeRef}
              runtimeState={runtimeState}
              onReload={reloadAuthoritativeDocument}
            />
          ) : (
            <button className="empty-state" onClick={importHtml}>
              <span>＋</span>
              <strong>打开一个 HTML 文件</strong>
              <small>项目、图片与历史记录仅保存在本机</small>
            </button>
          )}
        </section>

        <aside className="right-panel">
          <h2>属性</h2>
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

              {(selection.chart || selection.isChartBlock) && (
                <section className="chart-editor">
                  <div className="chart-editor-heading">
                    <strong>图表</strong>
                    <span>{selection.chart?.engine === "echarts" ? "ECharts" : "配置"}</span>
                  </div>
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
                      onChange={(event) => postToEditor({
                        action: "chart-patch",
                        patch: { primaryColor: event.target.value }
                      })}
                    />
                  </label>
                  <div className="field-row">
                    <label>
                      图表类型
                      <select
                        key={`chart-type-${selection.chart.key}`}
                        defaultValue="line"
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
                    <button onClick={() => postToEditor({ action: "import-video" })}>
                      🎬 视频导入
                    </button>
                  </div>
                  <label>
                    图表数据 JSON
                    <textarea
                      className="chart-data-editor"
                      key={`chart-data-${selection.chart?.key ?? selection.nodeId}-${JSON.stringify(
                        selection.chart?.data
                      )}`}
                      defaultValue={JSON.stringify(
                        selection.chart?.data ?? { labels: [], series: [] },
                        null,
                        2
                      )}
                      onBlur={(event) => {
                        try {
                          const parsed = ChartDataSchema.safeParse(
                            JSON.parse(event.target.value)
                          );
                          if (!parsed.success) {
                            setNotice("图表数据 JSON 格式错误");
                            return;
                          }
                          postToEditor({
                            action: "chart-patch",
                            patch: { data: parsed.data }
                          });
                        } catch {
                          setNotice("图表数据不是有效的 JSON");
                        }
                      }}
                    />
                  </label>
                  <small>
                    图表配置保存在项目命令中，可撤销、恢复并用于导出。
                  </small>
                </section>
              )}

              {selection.canEditText && (
                <label>
                  文字内容
                  <textarea
                    key={`text-${selection.nodeId}-${selection.text}`}
                    defaultValue={selection.text}
                    onBlur={(event) => postToEditor({
                      action: "set-text",
                      text: event.target.value
                    })}
                  />
                </label>
              )}

              {(selection.hasTextSelection || selection.textFormat) && (
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
                    <input
                      type="color"
                      title="文字颜色"
                      key={`fore-${selection.nodeId}-${selection.textFormat?.foreColor ?? ""}`}
                      defaultValue={selection.textFormat?.foreColor || "#000000"}
                      onChange={(event) => postToEditor({ action: "text-style", property: "color", value: event.target.value })}
                    />
                    <input
                      type="color"
                      title="背景高亮"
                      key={`hilite-${selection.nodeId}-${selection.textFormat?.hiliteColor ?? ""}`}
                      defaultValue={selection.textFormat?.hiliteColor || "#ffff00"}
                      onChange={(event) => postToEditor({ action: "text-style", property: "background-color", value: event.target.value })}
                    />
                    <select
                      title="字号"
                      key={`fs-${selection.nodeId}-${selection.textFormat?.fontSize ?? ""}`}
                      defaultValue={selection.textFormat?.fontSize || ""}
                      onChange={(event) => { if (event.target.value) postToEditor({ action: "text-style", property: "font-size", value: event.target.value }); }}
                    >
                      <option value="" disabled>字号</option>
                      <option value="12px">12</option>
                      <option value="14px">14</option>
                      <option value="16px">16</option>
                      <option value="18px">18</option>
                      <option value="20px">20</option>
                      <option value="24px">24</option>
                      <option value="32px">32</option>
                      <option value="48px">48</option>
                    </select>
                  </div>
                  <small>选中文字后可修改样式；按 Ctrl+Z 撤销</small>
                </section>
              )}

              {selection.tagName === "img" && (
                <section className="image-info">
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
                    点击工具栏「插入 / 替换图片」可更换图片源；
                    拖动四角蓝点缩放，按 Shift 等比缩放。
                  </small>
                </section>
              )}

              <label>
                对象对齐
                <div className="align-grid">
                  <button onClick={() => align("left")} disabled={selection.count < 2}>左</button>
                  <button onClick={() => align("center")} disabled={selection.count < 2}>水平中</button>
                  <button onClick={() => align("right")} disabled={selection.count < 2}>右</button>
                  <button onClick={() => align("top")} disabled={selection.count < 2}>上</button>
                  <button onClick={() => align("middle")} disabled={selection.count < 2}>垂直中</button>
                  <button onClick={() => align("bottom")} disabled={selection.count < 2}>下</button>
                </div>
              </label>

              <div className="field-row">
                <label>
                  宽度
                  <input
                    key={`width-${selection.nodeId}-${selection.width}`}
                    type="number"
                    min="12"
                    defaultValue={selection.width}
                    onChange={(event) => setStyle("width", `${event.target.value}px`)}
                  />
                </label>
                <label>
                  高度
                  <input
                    key={`height-${selection.nodeId}-${selection.height}`}
                    type="number"
                    min="12"
                    defaultValue={selection.height}
                    onChange={(event) => setStyle("height", `${event.target.value}px`)}
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
                    onChange={(event) => setStyle("font-size", `${event.target.value}px`)}
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
                    onChange={(event) => setStyle("border-radius", `${event.target.value}px`)}
                  />
                </label>
              </div>

              <label>
                背景色
                <input
                  key={`bg-${selection.nodeId}-${selection.backgroundColor ?? "transparent"}`}
                  type="color"
                  defaultValue={selection.backgroundColor || "#ffffff"}
                  onChange={(event) => setStyle("background-color", event.target.value)}
                />
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

              {/* --- Trait Manager (GrapesJS traits) --- */}
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

              {/* --- Z-index controls --- */}
              <label>层级</label>
              <div className="field-row">
                <button
                  onClick={() => postToEditor({ action: "adjust-zindex", delta: 10 })}
                >上移 Ctrl+]</button>
                <button
                  onClick={() => postToEditor({ action: "adjust-zindex", delta: -10 })}
                >下移 Ctrl+[</button>
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
          ) : <p className="muted">单击画布对象以显示编辑属性</p>}

          {/* --- Layers tree (GrapesJS LayerManager) --- */}
          <h2 style={{ marginTop: 16 }}>图层</h2>
          <button
            onClick={() => {
              setShowLayers(!showLayers);
              if (!showLayers) postToEditor({ action: "request-layers" });
            }}
            style={{ marginBottom: 8 }}
          >
            {showLayers ? "隐藏" : "显示"}图层树
          </button>
          {showLayers && layers.length > 0 && (
            <LayerTree
              nodes={layers}
              selectedId={selection?.nodeId ?? null}
              onSelect={(nodeId) => {
                postToEditor({ action: "clear-selection" });
                iframeRef.current?.contentWindow?.postMessage({
                  source: "html-studio-host",
                  action: "restore-editor-state",
                  state: { scrollX: window.scrollX, scrollY: window.scrollY, selectedNodeIds: [nodeId] }
                } satisfies HostToEditorMessage, "*");
              }}
            />
          )}
        </aside>
      </section>

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
        <span className="status-spacer" /><span>SQLite WAL · Checkpoint/Replay</span>
      </footer>

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
          <input type="color" title="文字颜色"
            key="float-toolbar-color"
            onChange={(e) => postToEditor({ action: "text-style", property: "color", value: e.target.value })}
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
