import { basename, dirname, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from "electron";
import type { ProjectManager } from "../application/projects/project-manager";
import {
  IPC_CHANNELS
} from "../shared/ipc";
import { z } from "zod";
import { CommandEnvelopeSchema } from "../domain/commands/schema";
import { asErrorMessage } from "../shared/errors";
import { createEditorDocumentResponse } from
  "../infrastructure/protocol/editor-document";
import { createPdfDocumentResponse } from
  "../infrastructure/protocol/editor-document";
import { PdfExportOptionsSchema } from "../domain/pdf/export-options";
import type { PdfExportService } from "../application/pdf/pdf-export-service";
import { PptxExportOptionsSchema } from "../domain/pptx/export-options";
import type { PptxExportService } from "../application/pptx/pptx-export-service";
import "./crash-reporter";
import { setupAutoUpdater } from "./auto-updater";
import { getSessionId } from "./anonymous-session";

const ExecuteCommandRequestSchema = z.object({
  projectId: z.string().min(1),
  command: CommandEnvelopeSchema
});
const ExportPdfRequestSchema = z.object({
  projectId: z.string().min(1),
  options: PdfExportOptionsSchema
});
const ExportPptxRequestSchema = z.object({
  projectId: z.string().min(1),
  options: PptxExportOptionsSchema
});
const ProjectIdSchema = z.string().regex(/^project_[0-9a-f-]{36}$/i);
const MaterializeProjectSchema = z.object({
  projectId: ProjectIdSchema,
  html: z.string().min(1).max(50 * 1024 * 1024)
});

const RUNTIME_VENDOR_PATHS: Record<string, string> = {
  "/vendor/echarts.min.js": "node_modules/echarts/dist/echarts.min.js",
  "/vendor/echarts-wordcloud.min.js":
    "node_modules/echarts-wordcloud/dist/echarts-wordcloud.min.js",
  "/vendor/chart.umd.min.js": "node_modules/chart.js/dist/chart.umd.js",
  "/vendor/tailwind-browser.js":
    "node_modules/@tailwindcss/browser/dist/index.global.js",
  "/vendor/bootstrap.bundle.min.js":
    "node_modules/bootstrap/dist/js/bootstrap.bundle.min.js",
  "/vendor/bootstrap.min.css":
    "node_modules/bootstrap/dist/css/bootstrap.min.css",
  "/vendor/d3.min.js": "node_modules/d3/dist/d3.min.js",
  "/vendor/highcharts.min.js": "node_modules/highcharts/highcharts.js",
  "/vendor/highcharts-more.min.js":
    "node_modules/highcharts/highcharts-more.js",
  "/vendor/highcharts-exporting.min.js":
    "node_modules/highcharts/modules/exporting.js",
  "/vendor/highcharts-export-data.min.js":
    "node_modules/highcharts/modules/export-data.js",
  "/vendor/highcharts-accessibility.min.js":
    "node_modules/highcharts/modules/accessibility.js",
  "/vendor/plotly.min.js":
    "node_modules/plotly.js-dist-min/plotly.min.js",
  "/vendor/mermaid.min.js": "node_modules/mermaid/dist/mermaid.min.js",
  "/vendor/gsap.min.js": "node_modules/gsap/dist/gsap.min.js",
  "/vendor/ScrollTrigger.min.js":
    "node_modules/gsap/dist/ScrollTrigger.min.js",
  "/vendor/three.min.js": "node_modules/three/build/three.min.js",
  "/vendor/anime.min.js": "node_modules/animejs/lib/anime.min.js",
  "/vendor/alpine.min.js": "node_modules/alpinejs/dist/cdn.min.js",
  "/vendor/swiper-bundle.min.js":
    "node_modules/swiper/swiper-bundle.min.js",
  "/vendor/swiper-bundle.min.css":
    "node_modules/swiper/swiper-bundle.min.css",
  "/vendor/aos.min.js": "node_modules/aos/dist/aos.js",
  "/vendor/aos.min.css": "node_modules/aos/dist/aos.css",
  "/vendor/fontawesome.min.css":
    "node_modules/@fortawesome/fontawesome-free/css/all.min.css"
};

protocol.registerSchemesAsPrivileged([{
  scheme: "htmlstudio-project",
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true
  }
}, {
  scheme: "htmlstudio-runtime",
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true
  }
}]);

let projectManager: ProjectManager;
let pdfExportService: PdfExportService;
let pptxExportService: PptxExportService;
let mainWindow: BrowserWindow | null = null;
let lastPptxExportDirectory: string | null = null;

function nextAvailableFilePath(targetPath: string): string {
  if (!existsSync(targetPath)) return targetPath;
  const extension = extname(targetPath);
  const stem = basename(targetPath, extension);
  const directory = dirname(targetPath);
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = join(directory, `${stem} (${index})${extension}`);
    if (!existsSync(candidate)) return candidate;
  }
  return join(directory, `${stem}-${Date.now()}${extension}`);
}

app.setName("SierraStudio");
if (process.env.SIERRASTUDIO_USER_DATA_DIR) {
  app.setPath("userData", process.env.SIERRASTUDIO_USER_DATA_DIR);
}

function assertTrustedIpcSender(
  event: IpcMainInvokeEvent | IpcMainEvent
): void {
  if (
    !mainWindow
    || event.sender !== mainWindow.webContents
    || event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error("Rejected IPC from an untrusted frame");
  }
}

function sendOperationProgress(
  event: IpcMainInvokeEvent,
  active: boolean,
  label?: string
): void {
  if (!event.sender.isDestroyed()) {
    event.sender.send(IPC_CHANNELS.operationProgress, { active, label });
  }
}

const STARTUP_DOCUMENT = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SierraStudio</title>
  <style>
    html,body{width:100%;height:100%;margin:0;background:#111318;overflow:hidden}
    body{display:grid;place-content:center;color:#e7e9ee;text-align:center;
      font:500 14px/1.5 system-ui,"Microsoft YaHei",sans-serif;letter-spacing:.04em}
    strong{font-size:22px;letter-spacing:.02em}
    p{margin:12px 0 14px;color:#aeb4c0}
    i{display:block;width:220px;height:3px;overflow:hidden;border-radius:3px;background:#292d36}
    i:after{content:"";display:block;width:42%;height:100%;border-radius:inherit;
      background:#d6b06e;animation:slide 1.15s ease-in-out infinite}
    @keyframes slide{from{transform:translateX(-110%)}to{transform:translateX(350%)}}
  </style>
</head>
<body><main role="status"><strong>SierraStudio</strong><p>正在加载编辑器…</p><i></i></main></body>
</html>`;

async function createStartupWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    center: true,
    show: false,
    frame: false,
    backgroundColor: "#111318",
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  await window.loadURL(
    `data:text/html;charset=UTF-8,${encodeURIComponent(STARTUP_DOCUMENT)}`
  );
  if (!window.isDestroyed()) {
    // Let the hidden startup document complete a compositor cycle before the
    // native window becomes visible, avoiding an exposed about:blank frame.
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    window.show();
  }
  return window;
}

function createWindow(startupWindow?: BrowserWindow): BrowserWindow {
  const window = new BrowserWindow({
    title: "SierraStudio",
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    center: true,
    show: false,
    backgroundColor: "#111318",
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#111318",
      symbolColor: "#c9cdd6",
      height: 56
    },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  );
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (targetUrl !== window.webContents.getURL()) event.preventDefault();
  });

  const load = async (): Promise<void> => {
    await loadApplication(window);
    if (window.isDestroyed()) return;
    window.show();
    if (startupWindow && !startupWindow.isDestroyed()) startupWindow.destroy();
  };
  void load().catch((error) => {
    console.error("Application window failed to load", error);
    if (!window.isDestroyed()) window.show();
    if (startupWindow && !startupWindow.isDestroyed()) startupWindow.destroy();
  });
  return window;
}

async function loadApplication(window: BrowserWindow): Promise<void> {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  const startupWindow = await createStartupWindow();
  const [
    { ProjectManager: ProjectManagerClass },
    { PdfExportService: PdfExportServiceClass },
    { ElectronPdfRenderer: ElectronPdfRendererClass },
    { PptxExportService: PptxExportServiceClass },
    { ElectronPptxRenderer: ElectronPptxRendererClass }
  ] = await Promise.all([
    import("../application/projects/project-manager"),
    import("../application/pdf/pdf-export-service"),
    import("../infrastructure/pdf/electron-pdf-renderer"),
    import("../application/pptx/pptx-export-service"),
    import("../infrastructure/pptx/electron-pptx-renderer")
  ]);
  projectManager = new ProjectManagerClass(join(app.getPath("userData"), "projects"));
  pdfExportService = new PdfExportServiceClass(
    projectManager,
    new ElectronPdfRendererClass()
  );
  pptxExportService = new PptxExportServiceClass(
    projectManager,
    new ElectronPptxRendererClass()
  );

  // Cloud: anonymous session and auto-update
  setupAutoUpdater();
  console.log("[SierraStudio] Session:", getSessionId().slice(0, 8) + "...");

  protocol.handle("htmlstudio-project", async (request) => {
    const url = new URL(request.url);
    try {
      const filePath = projectManager.resolveProjectPath(url.hostname, url.pathname);
      if (url.pathname === "/working/index.html") {
        const sourceHtml = await readFile(filePath, "utf8");
        if (url.searchParams.get("export") === "1") {
          return createPdfDocumentResponse(
            sourceHtml,
            projectManager.getProjectFeatures(url.hostname).watermarks
          );
        }
        const runtimeUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
          ? new URL(
            `/@fs/${join(
              app.getAppPath(),
              "src/editor-runtime/index.ts"
            ).replaceAll("\\", "/")}`,
            process.env.ELECTRON_RENDERER_URL
          ).toString()
          : "htmlstudio-runtime://bundle/editor-runtime.js";
        return createEditorDocumentResponse(
          sourceHtml,
          runtimeUrl
        );
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });

  protocol.handle("htmlstudio-runtime", async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "bundle") {
      return new Response("Not found", { status: 404 });
    }
    if (url.pathname === "/editor-runtime.js") {
      if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
        return net.fetch(
          `${process.env.ELECTRON_RENDERER_URL.replace(/\/$/, "")}/editor-runtime.js`
        );
      }
      const runtimeSource = await readFile(
        join(__dirname, "../renderer/editor-runtime.js")
      );
      return new Response(runtimeSource, {
        headers: {
          "content-type": "text/javascript; charset=utf-8"
        }
      });
    }
    if (/^\/assets\/[a-z0-9_.-]+\.js$/i.test(url.pathname)) {
      try {
        const assetSource = await readFile(join(
          __dirname,
          "../renderer",
          url.pathname.slice(1)
        ));
        return new Response(assetSource, {
          headers: {
            "content-type": "text/javascript; charset=utf-8"
          }
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }
    const relativeVendorPath = RUNTIME_VENDOR_PATHS[url.pathname];
    const packagedVendorPath = url.pathname.startsWith("/vendor/")
      && !url.pathname.includes("..")
      ? url.pathname.slice("/vendor/".length)
      : null;
    const isBundledDynamicAsset = packagedVendorPath
      && (
        packagedVendorPath === "fonts.css"
        || /^fonts\/[a-z0-9-]+\/[a-z0-9-]+\.(?:woff2?|ttf)$/i.test(
          packagedVendorPath
        )
        || /^webfonts\/[a-z0-9-]+\.(?:woff2?|ttf)$/i.test(
          packagedVendorPath
        )
      );
    let developmentDynamicPath: string | null = null;
    if (packagedVendorPath?.startsWith("fonts/")) {
      const [, family, fileName] = packagedVendorPath.split("/");
      const fontPackages: Record<string, string> = {
        inter: "@fontsource-variable/inter",
        "noto-sans-sc": "@fontsource-variable/noto-sans-sc",
        "noto-serif-sc": "@fontsource-variable/noto-serif-sc",
        roboto: "@fontsource-variable/roboto",
        "open-sans": "@fontsource-variable/open-sans",
        montserrat: "@fontsource-variable/montserrat",
        poppins: "@fontsource/poppins",
        "barlow-condensed": "@fontsource/barlow-condensed",
        "ibm-plex-mono": "@fontsource/ibm-plex-mono",
        "roboto-mono": "@fontsource-variable/roboto-mono"
      };
      const packageName = family ? fontPackages[family] : null;
      if (family === "alibaba-puhuiti" && fileName) {
        developmentDynamicPath =
          `out/renderer/vendor/fonts/${family}/${fileName}`;
      } else if (packageName && fileName) {
        developmentDynamicPath =
          `node_modules/${packageName}/files/${fileName}`;
      }
    } else if (packagedVendorPath?.startsWith("webfonts/")) {
      developmentDynamicPath =
        `node_modules/@fortawesome/fontawesome-free/${packagedVendorPath}`;
    }
    const generatedVendorAsset =
      packagedVendorPath === "fonts.css"
      || packagedVendorPath === "fontawesome.min.css";
    const vendorPath = relativeVendorPath || isBundledDynamicAsset
      ? app.isPackaged
        ? join(__dirname, "../renderer/vendor", packagedVendorPath ?? "")
        : generatedVendorAsset
          ? join(
            app.getAppPath(),
            "out/renderer/vendor",
            packagedVendorPath
          )
          : join(
            app.getAppPath(),
            developmentDynamicPath ?? relativeVendorPath ?? ""
          )
      : null;
    if (!vendorPath) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(vendorPath).toString());
  });

  ipcMain.handle(IPC_CHANNELS.importHtml, async (event) => {
    assertTrustedIpcSender(event);
    try {
      const selection = await dialog.showOpenDialog({
        title: "导入 HTML",
        properties: ["openFile"],
        filters: [{ name: "HTML", extensions: ["html", "htm"] }]
      });
      const sourcePath = selection.filePaths[0];
      if (selection.canceled || !sourcePath) return { canceled: true };
      sendOperationProgress(event, true, "正在导入 HTML 并整理本地资源…");
      try {
        return {
          canceled: false,
          project: await projectManager.importHtml(sourcePath)
        };
      } finally {
        sendOperationProgress(event, false);
      }
    } catch (error) {
      console.error("HTML import failed", error);
      return {
        canceled: false,
        error: asErrorMessage(error)
      };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.listProjects,
    async (event) => {
      assertTrustedIpcSender(event);
      return projectManager.listProjects();
    }
  );
  ipcMain.handle(IPC_CHANNELS.ensureWelcomeProject, async (event) => {
    assertTrustedIpcSender(event);
    return projectManager.ensureWelcomeProject();
  });
  ipcMain.handle(IPC_CHANNELS.openProject, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    const projectId = ProjectIdSchema.parse(input);
    return projectManager.openProject(projectId);
  });

  ipcMain.handle(IPC_CHANNELS.executeCommand, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    const request = ExecuteCommandRequestSchema.parse(input);
    return projectManager.execute(request.projectId, request.command);
  });

  ipcMain.handle(IPC_CHANNELS.exportStatic, async (event, projectId: string) => {
    assertTrustedIpcSender(event);
    const selection = await dialog.showOpenDialog({
      title: "选择导出目录",
      properties: ["openDirectory", "createDirectory"]
    });
    const directory = selection.filePaths[0];
    if (selection.canceled || !directory) return { canceled: true };
    sendOperationProgress(event, true, "正在导出 HTML 资源包…");
    try {
      return {
        canceled: false,
        exportPath: await projectManager.exportStatic(projectId, directory)
      };
    } finally {
      sendOperationProgress(event, false);
    }
  });

  ipcMain.handle(IPC_CHANNELS.importImage, async (event, projectId: string) => {
    assertTrustedIpcSender(event);
    const selection = await dialog.showOpenDialog({
      title: "选择图片",
      properties: ["openFile"],
      filters: [{
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"]
      }]
    });
    const sourcePath = selection.filePaths[0];
    if (selection.canceled || !sourcePath) return { canceled: true };
    return {
      canceled: false,
      imageSource: await projectManager.importImage(projectId, sourcePath)
    };
  });

  ipcMain.handle(IPC_CHANNELS.importImages, async (event, projectId: string) => {
    assertTrustedIpcSender(event);
    const selection = await dialog.showOpenDialog({
      title: "按顺序选择要批量嵌入的图片",
      properties: ["openFile", "multiSelections"],
      filters: [{
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"]
      }]
    });
    if (selection.canceled || selection.filePaths.length === 0) {
      return { canceled: true };
    }
    return {
      canceled: false,
      images: await projectManager.importImages(
        projectId,
        selection.filePaths
      )
    };
  });

  ipcMain.handle(
    IPC_CHANNELS.importMedia,
    async (
      event,
      projectId: string,
      mediaType: "image" | "video"
    ) => {
      assertTrustedIpcSender(event);
      const isVideo = mediaType === "video";
      const selection = await dialog.showOpenDialog({
        title: isVideo ? "选择视频" : "选择图片",
        properties: ["openFile"],
        filters: [{
          name: isVideo ? "Videos" : "Images",
          extensions: isVideo
            ? ["mp4", "webm", "ogg", "mov"]
            : ["png", "jpg", "jpeg", "gif", "webp", "svg"]
        }]
      });
      const sourcePath = selection.filePaths[0];
      if (selection.canceled || !sourcePath) return { canceled: true };
      return {
        canceled: false,
        assetPath: await projectManager.importMedia(
          projectId,
          sourcePath,
          mediaType
        ),
        originalName: basename(sourcePath)
      };
    }
  );
  ipcMain.handle(
    IPC_CHANNELS.materializeProject,
    async (event, input: unknown) => {
      assertTrustedIpcSender(event);
      const request = MaterializeProjectSchema.parse(input);
      return projectManager.materializeProject(
        request.projectId,
        request.html
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.undo,
    async (event, projectId: string) => {
      assertTrustedIpcSender(event);
      return projectManager.undo(projectId);
    }
  );
  ipcMain.handle(
    IPC_CHANNELS.redo,
    async (event, projectId: string) => {
      assertTrustedIpcSender(event);
      return projectManager.redo(projectId);
    }
  );
  ipcMain.handle(
    IPC_CHANNELS.updateFeatures,
    async (event, input: unknown) => {
      assertTrustedIpcSender(event);
      if (!input || typeof input !== "object") {
        throw new Error("Invalid project feature request");
      }
      const request = input as { projectId?: unknown; features?: unknown };
      if (typeof request.projectId !== "string") {
        throw new Error("Invalid project id");
      }
      return projectManager.updateProjectFeatures(
        request.projectId,
        request.features
      );
    }
  );
  ipcMain.handle(IPC_CHANNELS.exportPdf, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    try {
      const request = ExportPdfRequestSchema.parse(input);
      const project = projectManager.getPdfExportSource(request.projectId);
      const suffix = request.options.mode === "smart"
        ? "-智能分页"
        : "-长图";
      const selection = await dialog.showSaveDialog({
        title: "导出 PDF",
        defaultPath: `${project.name}${suffix}.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }]
      });
      if (selection.canceled || !selection.filePath) return { canceled: true };
      sendOperationProgress(event, true, "正在生成 PDF，请勿关闭窗口…");
      try {
        return {
          canceled: false,
          result: await pdfExportService.export(
            request.projectId,
            selection.filePath,
            request.options
          )
        };
      } finally {
        sendOperationProgress(event, false);
      }
    } catch (error) {
      console.error("PDF export failed", error);
      return {
        canceled: false,
        error: asErrorMessage(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.exportPptx, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    try {
      const request = ExportPptxRequestSchema.parse(input);
      const project = projectManager.getPdfExportSource(request.projectId);
      const suffix = request.options.mode === "hybrid"
        ? "-智能混合"
        : request.options.mode === "editable"
          ? "-完全可编辑"
          : "-高清还原";
      const fileName = `${project.name}${suffix}.pptx`;
      const defaultDirectory = lastPptxExportDirectory
        ?? app.getPath("documents");
      const saveDialogOptions = {
        title: "导出 PowerPoint",
        defaultPath: nextAvailableFilePath(join(defaultDirectory, fileName)),
        filters: [{ name: "PowerPoint", extensions: ["pptx"] }]
      };
      const owner = BrowserWindow.fromWebContents(event.sender);
      const selection = owner
        ? await dialog.showSaveDialog(owner, saveDialogOptions)
        : await dialog.showSaveDialog(saveDialogOptions);
      if (selection.canceled || !selection.filePath) return { canceled: true };
      lastPptxExportDirectory = dirname(selection.filePath);
      const outputPath = nextAvailableFilePath(selection.filePath);
      sendOperationProgress(
        event,
        true,
        "正在逐页生成 PowerPoint，请勿关闭窗口…"
      );
      try {
        return {
          canceled: false,
          result: await pptxExportService.export(
            request.projectId,
            outputPath,
            request.options
          )
        };
      } finally {
        sendOperationProgress(event, false);
      }
    } catch (error) {
      console.error("PowerPoint export failed", error);
      return {
        canceled: false,
        error: asErrorMessage(error)
      };
    }
  });

  // ── Auto-update IPC ──
  ipcMain.handle(IPC_CHANNELS.checkForUpdate, async (event) => {
    assertTrustedIpcSender(event);
    // Allow override via env; default to the project's GitHub repo
    const repo = process.env.SIERRASTUDIO_UPDATE_REPO || "poopoo5194379/sierra-studio";

    const { autoUpdater } = await import("electron-updater");
    const [owner, repoName] = repo.split("/");
    if (!owner || !repoName) return { updateAvailable: false };

    autoUpdater.setFeedURL({
      provider: "github",
      owner,
      repo: repoName
    });

    try {
      const result = await autoUpdater.checkForUpdates();
      return { updateAvailable: !!result?.updateInfo?.version };
    } catch {
      return { updateAvailable: false };
    }
  });
  ipcMain.on(IPC_CHANNELS.quitAndInstall, (event) => {
    assertTrustedIpcSender(event);
    const { autoUpdater } = require("electron-updater");
    autoUpdater.quitAndInstall();
  });

  mainWindow = createWindow(startupWindow);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  projectManager?.close();
});
