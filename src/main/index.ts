import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  shell
} from "electron";
import { ProjectManager } from "../application/projects/project-manager";
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
import { PdfExportService } from "../application/pdf/pdf-export-service";
import { ElectronPdfRenderer } from
  "../infrastructure/pdf/electron-pdf-renderer";
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

app.setName("SierraStudio");

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: "SierraStudio",
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#111318",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return window;
}

app.whenReady().then(() => {
  projectManager = new ProjectManager(join(app.getPath("userData"), "projects"));
  pdfExportService = new PdfExportService(
    projectManager,
    new ElectronPdfRenderer()
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
          return createPdfDocumentResponse(sourceHtml);
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
    if (url.hostname !== "bundle" || url.pathname !== "/editor-runtime.js") {
      return new Response("Not found", { status: 404 });
    }
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      return net.fetch(
        `${process.env.ELECTRON_RENDERER_URL.replace(/\/$/, "")}/editor-runtime.js`
      );
    }
    return net.fetch(pathToFileURL(
      join(__dirname, "../renderer/editor-runtime.js")
    ).toString());
  });

  ipcMain.handle(IPC_CHANNELS.importHtml, async () => {
    try {
      const selection = await dialog.showOpenDialog({
        title: "导入 HTML",
        properties: ["openFile"],
        filters: [{ name: "HTML", extensions: ["html", "htm"] }]
      });
      const sourcePath = selection.filePaths[0];
      if (selection.canceled || !sourcePath) return { canceled: true };
      return {
        canceled: false,
        project: await projectManager.importHtml(sourcePath)
      };
    } catch (error) {
      console.error("HTML import failed", error);
      return {
        canceled: false,
        error: asErrorMessage(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.executeCommand, async (_event, input: unknown) => {
    const request = ExecuteCommandRequestSchema.parse(input);
    return projectManager.execute(request.projectId, request.command);
  });

  ipcMain.handle(IPC_CHANNELS.exportStatic, async (_event, projectId: string) => {
    const selection = await dialog.showOpenDialog({
      title: "选择导出目录",
      properties: ["openDirectory", "createDirectory"]
    });
    const directory = selection.filePaths[0];
    if (selection.canceled || !directory) return { canceled: true };
    return {
      canceled: false,
      exportPath: await projectManager.exportStatic(projectId, directory)
    };
  });

  ipcMain.handle(IPC_CHANNELS.importImage, async (_event, projectId: string) => {
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
      assetPath: await projectManager.importImage(projectId, sourcePath)
    };
  });

  ipcMain.handle(
    IPC_CHANNELS.undo,
    async (_event, projectId: string) => projectManager.undo(projectId)
  );
  ipcMain.handle(
    IPC_CHANNELS.redo,
    async (_event, projectId: string) => projectManager.redo(projectId)
  );
  ipcMain.handle(IPC_CHANNELS.exportPdf, async (_event, input: unknown) => {
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
      return {
        canceled: false,
        result: await pdfExportService.export(
          request.projectId,
          selection.filePath,
          request.options
        )
      };
    } catch (error) {
      console.error("PDF export failed", error);
      return {
        canceled: false,
        error: asErrorMessage(error)
      };
    }
  });

  // ── Auto-update IPC ──
  ipcMain.handle(IPC_CHANNELS.checkForUpdate, async () => {
    const repo = process.env.SIERRASTUDIO_UPDATE_REPO || "";
    if (!repo) return { updateAvailable: false, reason: "no-repo" };

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
  ipcMain.on(IPC_CHANNELS.quitAndInstall, () => {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.quitAndInstall();
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  projectManager?.close();
});
