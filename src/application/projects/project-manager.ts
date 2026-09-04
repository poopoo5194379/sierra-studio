import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { parseHTML } from "linkedom";
import { setTimeout as delay } from "node:timers/promises";
import { AssetImporter } from "../../infrastructure/import/asset-importer";
import { atomicWriteFile } from "../../infrastructure/filesystem/atomic-files";
import { createSafeWorkingDocument, stripEditorMetadata } from "../../domain/document/html-document";
import { injectChartOverrideBootstrap } from "../../domain/document/chart-override-bootstrap";
import { newDocumentId, newProjectId } from "../../shared/ids";
import { HtmlStudioError } from "../../shared/errors";
import { ProjectSession, type UndoRedoResult } from "./project-session";
import type { ProjectSummary } from "../../shared/ipc";
import type { ImportCompatibilityReport } from "../../shared/import-compatibility";
import { scanImportCompatibility } from "../../infrastructure/import/compatibility-scanner";
import {
  parseProjectFeatures,
  type ProjectFeatures
} from "../../shared/project-features";
import {
  WELCOME_SAMPLE_HTML,
  WELCOME_SAMPLE_NAME
} from "../../domain/document/welcome-sample";
import { readWatermarkSettings } from "../../domain/watermarks/watermark-model";

export interface ProjectSnapshot {
  projectId: string;
  documentId: string;
  revision: number;
  documentUrl: string;
  name: string;
  warnings: string[];
  compatibility: ImportCompatibilityReport;
  features: ProjectFeatures;
}

function isTransientDirectoryCommitError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && ["EPERM", "EBUSY", "EACCES"].includes(String(error.code));
}

async function commitStagingDirectory(
  stagingRoot: string,
  projectRoot: string
): Promise<void> {
  const attempts = process.platform === "win32" ? 12 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rename(stagingRoot, projectRoot);
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientDirectoryCommitError(error)) throw error;
      await delay(Math.min(80 * 2 ** attempt, 1_000));
    }
  }

  // Antivirus/indexers can keep a Windows directory handle alive after the
  // SQLite session closes. Copying into the new, random project directory is
  // safe here and avoids making a successful import fail at the final rename.
  try {
    await cp(stagingRoot, projectRoot, {
      recursive: true,
      errorOnExist: true,
      force: false
    });
    await rm(stagingRoot, { recursive: true, force: true });
  } catch (copyError) {
    await rm(projectRoot, { recursive: true, force: true });
    throw copyError instanceof Error ? copyError : lastError;
  }
}

export class ProjectManager {
  private readonly sessions = new Map<string, ProjectSession>();
  private readonly roots = new Map<string, string>();
  private readonly names = new Map<string, string>();
  private readonly compatibility = new Map<
    string,
    ImportCompatibilityReport
  >();
  private welcomeProjectPromise: Promise<ProjectSnapshot> | null = null;

  constructor(private readonly projectsDirectory: string) {}

  async listProjects(): Promise<ProjectSummary[]> {
    await mkdir(this.projectsDirectory, { recursive: true });
    const entries = await readdir(this.projectsDirectory, { withFileTypes: true });
    const projects = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("project_"))
      .map(async (entry): Promise<ProjectSummary | null> => {
        try {
          const metadata = JSON.parse(await readFile(
            join(this.projectsDirectory, entry.name, "project.json"),
            "utf8"
          )) as Record<string, unknown>;
          if (
            metadata.projectId !== entry.name
            || typeof metadata.name !== "string"
          ) {
            return null;
          }
          return {
            projectId: entry.name,
            name: metadata.name,
            importedAt: typeof metadata.importedAt === "string"
              ? metadata.importedAt
              : ""
          };
        } catch {
          return null;
        }
      }));
    return projects
      .filter((project): project is ProjectSummary => project !== null)
      .sort((left, right) => right.importedAt.localeCompare(left.importedAt));
  }

  async openProject(projectId: string): Promise<ProjectSnapshot> {
    if (!/^project_[0-9a-f-]{36}$/i.test(projectId)) {
      throw new HtmlStudioError("Invalid project id", "BAD_PROJECT_ID");
    }
    const existing = this.sessions.get(projectId);
    if (existing) {
      return this.toSnapshot(
        existing,
        this.names.get(projectId) ?? projectId
      );
    }
    const projectRoot = join(this.projectsDirectory, projectId);
    const metadata = JSON.parse(
      await readFile(join(projectRoot, "project.json"), "utf8")
    ) as Record<string, unknown>;
    if (
      metadata.projectId !== projectId
      || typeof metadata.name !== "string"
    ) {
      throw new HtmlStudioError("Project metadata is invalid", "BAD_PROJECT");
    }
    const session = await ProjectSession.open(projectRoot);
    if (session.projectId !== projectId) {
      session.close();
      throw new HtmlStudioError("Project id does not match its database", "BAD_PROJECT");
    }
    this.sessions.set(projectId, session);
    this.roots.set(projectId, projectRoot);
    this.names.set(projectId, metadata.name);
    const report = metadata.compatibility
      && typeof metadata.compatibility === "object"
      ? metadata.compatibility as ImportCompatibilityReport
      : scanImportCompatibility(session.snapshot().html);
    this.compatibility.set(projectId, report);
    return this.toSnapshot(session, metadata.name);
  }

  async importHtml(sourcePath: string): Promise<ProjectSnapshot> {
    const sourceHtml = await readFile(sourcePath, "utf8");
    return this.importHtmlSource(sourcePath, sourceHtml);
  }

  ensureWelcomeProject(): Promise<ProjectSnapshot> {
    if (!this.welcomeProjectPromise) {
      this.welcomeProjectPromise = this.importHtmlSource(
        join(this.projectsDirectory, `${WELCOME_SAMPLE_NAME}.html`),
        WELCOME_SAMPLE_HTML,
        WELCOME_SAMPLE_NAME
      ).catch((error) => {
        this.welcomeProjectPromise = null;
        throw error;
      });
    }
    return this.welcomeProjectPromise;
  }

  private async importHtmlSource(
    sourcePath: string,
    sourceHtml: string,
    projectNameOverride?: string
  ): Promise<ProjectSnapshot> {
    const projectId = newProjectId();
    const documentId = newDocumentId();
    const projectRoot = join(this.projectsDirectory, projectId);
    const stagingRoot = join(this.projectsDirectory, `.staging-${projectId}`);
    let stagingSession: ProjectSession | undefined;
    try {
      await mkdir(join(stagingRoot, "source"), { recursive: true });
      await atomicWriteFile(
        join(stagingRoot, "source", "index.original.html"),
        sourceHtml
      );

      const importer = new AssetImporter(stagingRoot);
      const localized = await importer.importHtml(sourcePath, sourceHtml);
      const workingHtml = createSafeWorkingDocument(localized.html);
      const projectName = projectNameOverride
        ?? basename(sourcePath).replace(/\.html?$/i, "");
      await atomicWriteFile(
        join(stagingRoot, "project.json"),
        JSON.stringify({
          schemaVersion: 1,
          projectId,
          documentId,
          name: projectName,
          sourceFileName: basename(sourcePath),
          importedAt: new Date().toISOString(),
          compatibility: localized.compatibility
        }, null, 2)
      );

      stagingSession = await ProjectSession.create(
        stagingRoot,
        projectId,
        documentId,
        workingHtml,
        localized.assets
      );
      const importedWatermarks = readWatermarkSettings(
        parseHTML(workingHtml).document
      );
      if (importedWatermarks) {
        stagingSession.setProjectFeatures({
          ...stagingSession.getProjectFeatures(),
          watermarks: importedWatermarks
        });
      }
      stagingSession.close();
      stagingSession = undefined;
      await commitStagingDirectory(stagingRoot, projectRoot);
      const session = await ProjectSession.open(projectRoot);
      this.sessions.set(projectId, session);
      this.roots.set(projectId, projectRoot);
      this.names.set(projectId, projectName);
      this.compatibility.set(projectId, localized.compatibility);
      return this.toSnapshot(session, projectName, localized.warnings);
    } catch (error) {
      stagingSession?.close();
      await rm(stagingRoot, { recursive: true, force: true });
      throw error;
    }
  }

  async materializeProject(
    sourceProjectId: string,
    materializedHtml: string
  ): Promise<ProjectSnapshot> {
    const sourceRoot = this.requireRoot(sourceProjectId);
    const projectId = newProjectId();
    const documentId = newDocumentId();
    const projectRoot = join(this.projectsDirectory, projectId);
    const stagingRoot = join(this.projectsDirectory, `.staging-${projectId}`);
    let stagingSession: ProjectSession | undefined;
    try {
      await mkdir(join(stagingRoot, "source"), { recursive: true });
      await atomicWriteFile(
        join(stagingRoot, "source", "index.materialized.html"),
        materializedHtml
      );
      await cp(join(sourceRoot, "assets"), join(stagingRoot, "assets"), {
        recursive: true,
        force: true
      }).catch(() => undefined);
      const workingHtml = createSafeWorkingDocument(materializedHtml);
      const sourceName = this.names.get(sourceProjectId) ?? "HTML";
      const projectName = `${sourceName}（静态副本）`;
      const report = scanImportCompatibility(materializedHtml);
      await atomicWriteFile(
        join(stagingRoot, "project.json"),
        JSON.stringify({
          schemaVersion: 1,
          projectId,
          documentId,
          name: projectName,
          sourceFileName: "index.materialized.html",
          materializedFrom: sourceProjectId,
          importedAt: new Date().toISOString(),
          compatibility: report
        }, null, 2)
      );
      stagingSession = await ProjectSession.create(
        stagingRoot,
        projectId,
        documentId,
        workingHtml
      );
      const importedWatermarks = readWatermarkSettings(
        parseHTML(workingHtml).document
      );
      if (importedWatermarks) {
        stagingSession.setProjectFeatures({
          ...stagingSession.getProjectFeatures(),
          watermarks: importedWatermarks
        });
      }
      stagingSession.close();
      stagingSession = undefined;
      await commitStagingDirectory(stagingRoot, projectRoot);
      const session = await ProjectSession.open(projectRoot);
      this.sessions.set(projectId, session);
      this.roots.set(projectId, projectRoot);
      this.names.set(projectId, projectName);
      this.compatibility.set(projectId, report);
      return this.toSnapshot(session, projectName);
    } catch (error) {
      stagingSession?.close();
      await rm(stagingRoot, { recursive: true, force: true });
      throw error;
    }
  }

  async execute(projectId: string, command: unknown): Promise<{ revision: number }> {
    return this.requireSession(projectId).execute(command);
  }

  async undo(projectId: string): Promise<UndoRedoResult> {
    return this.requireSession(projectId).undo();
  }

  async redo(projectId: string): Promise<UndoRedoResult> {
    return this.requireSession(projectId).redo();
  }

  updateProjectFeatures(
    projectId: string,
    features: unknown
  ): ProjectFeatures {
    return this.requireSession(projectId).setProjectFeatures(
      parseProjectFeatures(features)
    );
  }

  async exportStatic(projectId: string, destinationDirectory: string): Promise<string> {
    const session = this.requireSession(projectId);
    const snapshot = session.snapshot();
    const exportRoot = join(
      destinationDirectory,
      `sierra-studio-export-${new Date().toISOString().replace(/[:.]/g, "-")}`
    );
    await mkdir(exportRoot, { recursive: true });
    const exportedHtml = injectChartOverrideBootstrap(
      stripEditorMetadata(snapshot.html)
    )
      .replaceAll("../assets/", "./assets/");
    await atomicWriteFile(join(exportRoot, "index.html"), exportedHtml);
    const projectRoot = this.requireRoot(projectId);
    await cp(join(projectRoot, "assets"), join(exportRoot, "assets"), {
      recursive: true,
      force: true
    }).catch(() => undefined);
    return exportRoot;
  }

  async importImage(projectId: string, sourcePath: string): Promise<string> {
    this.requireSession(projectId);
    const data = await readFile(sourcePath);
    const extension = extname(sourcePath).toLowerCase();
    const mimeType = ({
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml"
    } as const)[extension as ".png" | ".jpg" | ".jpeg" | ".gif" | ".webp" | ".svg"];
    if (!mimeType) {
      throw new HtmlStudioError(
        `Unsupported image type: ${extension || "(none)"}`,
        "UNSUPPORTED_IMAGE_TYPE"
      );
    }
    return `data:${mimeType};base64,${data.toString("base64")}`;
  }

  async importImages(
    projectId: string,
    sourcePaths: string[]
  ): Promise<Array<{ imageSource: string; originalName: string }>> {
    this.requireSession(projectId);
    return Promise.all(sourcePaths.map(async (sourcePath) => ({
      imageSource: await this.importImage(projectId, sourcePath),
      originalName: basename(sourcePath)
    })));
  }

  async importMedia(
    projectId: string,
    sourcePath: string,
    mediaType: "image" | "video"
  ): Promise<string> {
    const session = this.requireSession(projectId);
    const data = await readFile(sourcePath);
    const hash = createHash("sha256").update(data).digest("hex");
    const extension = extname(sourcePath).toLowerCase();
    const fileName = `${hash}${extension}`;
    const projectRoot = this.requireRoot(projectId);
    await atomicWriteFile(join(projectRoot, "assets", fileName), data);
    session.addAsset({
      id: `asset_${randomUUID()}`,
      sha256: hash,
      mimeType: mediaType === "video"
        ? ({
            ".mp4": "video/mp4",
            ".webm": "video/webm",
            ".ogg": "video/ogg",
            ".mov": "video/quicktime"
          }[extension] ?? "video/unknown")
        : extension === ".svg"
          ? "image/svg+xml"
          : `image/${extension.replace(".", "") || "unknown"}`,
      byteSize: data.byteLength,
      storedPath: `assets/${fileName}`,
      originalName: basename(sourcePath),
      originalUri: sourcePath
    });
    return `../assets/${fileName}`;
  }

  getPdfExportSource(projectId: string): {
    documentUrl: string;
    name: string;
  } {
    const session = this.requireSession(projectId);
    return {
      documentUrl:
        `htmlstudio-project://${projectId}/working/index.html?export=1`,
      name: this.names.get(projectId) ?? session.projectId
    };
  }

  getProjectFeatures(projectId: string): ProjectFeatures {
    return this.requireSession(projectId).getProjectFeatures();
  }

  resolveProjectPath(projectId: string, pathname: string): string {
    const root = this.requireRoot(projectId);
    const decoded = decodeURIComponent(pathname).replace(/^\/+/, "");
    const candidate = resolve(root, decoded);
    const relativePath = relative(root, candidate);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new HtmlStudioError("Project path traversal blocked", "PATH_TRAVERSAL");
    }
    const normalized = relativePath.replaceAll("\\", "/");
    if (
      normalized !== "working/index.html"
      && !normalized.startsWith("assets/")
    ) {
      throw new HtmlStudioError("Project path is private", "PRIVATE_PROJECT_PATH");
    }
    return candidate;
  }

  private requireSession(projectId: string): ProjectSession {
    const session = this.sessions.get(projectId);
    if (!session) throw new HtmlStudioError("Project is not open", "PROJECT_NOT_OPEN");
    return session;
  }

  private requireRoot(projectId: string): string {
    const root = this.roots.get(projectId);
    if (!root) throw new HtmlStudioError("Project is not open", "PROJECT_NOT_OPEN");
    return root;
  }

  private toSnapshot(
    session: ProjectSession,
    name: string,
    warnings: string[] = []
  ): ProjectSnapshot {
    const snapshot = session.snapshot();
    return {
      projectId: snapshot.projectId,
      documentId: snapshot.documentId,
      revision: snapshot.revision,
      name,
      warnings,
      compatibility: this.compatibility.get(session.projectId)
        ?? scanImportCompatibility(snapshot.html),
      features: session.getProjectFeatures(),
      documentUrl:
        `htmlstudio-project://${snapshot.projectId}/working/index.html`
    };
  }

  close(): void {
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
    this.roots.clear();
    this.names.clear();
    this.compatibility.clear();
  }
}
