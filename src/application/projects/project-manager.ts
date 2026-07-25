import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rename, rm } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { AssetImporter } from "../../infrastructure/import/asset-importer";
import { atomicWriteFile } from "../../infrastructure/filesystem/atomic-files";
import { createSafeWorkingDocument, stripEditorMetadata } from "../../domain/document/html-document";
import { injectChartOverrideBootstrap } from "../../domain/document/chart-override-bootstrap";
import { newDocumentId, newProjectId } from "../../shared/ids";
import { HtmlStudioError } from "../../shared/errors";
import { ProjectSession, type UndoRedoResult } from "./project-session";

export interface ProjectSnapshot {
  projectId: string;
  documentId: string;
  revision: number;
  documentUrl: string;
  name: string;
  warnings: string[];
}

export class ProjectManager {
  private readonly sessions = new Map<string, ProjectSession>();
  private readonly roots = new Map<string, string>();
  private readonly names = new Map<string, string>();

  constructor(private readonly projectsDirectory: string) {}

  async importHtml(sourcePath: string): Promise<ProjectSnapshot> {
    const projectId = newProjectId();
    const documentId = newDocumentId();
    const projectRoot = join(this.projectsDirectory, projectId);
    const stagingRoot = join(this.projectsDirectory, `.staging-${projectId}`);
    let stagingSession: ProjectSession | undefined;
    try {
      await mkdir(join(stagingRoot, "source"), { recursive: true });
      const sourceHtml = await readFile(sourcePath, "utf8");
      await atomicWriteFile(
        join(stagingRoot, "source", "index.original.html"),
        sourceHtml
      );

      const importer = new AssetImporter(stagingRoot);
      const localized = await importer.importHtml(sourcePath, sourceHtml);
      const workingHtml = createSafeWorkingDocument(localized.html);
      const projectName = basename(sourcePath).replace(/\.html?$/i, "");
      await atomicWriteFile(
        join(stagingRoot, "project.json"),
        JSON.stringify({
          schemaVersion: 1,
          projectId,
          documentId,
          name: projectName,
          sourceFileName: basename(sourcePath),
          importedAt: new Date().toISOString()
        }, null, 2)
      );

      stagingSession = await ProjectSession.create(
        stagingRoot,
        projectId,
        documentId,
        workingHtml,
        localized.assets
      );
      stagingSession.close();
      stagingSession = undefined;
      await rename(stagingRoot, projectRoot);
      const session = await ProjectSession.open(projectRoot);
      this.sessions.set(projectId, session);
      this.roots.set(projectId, projectRoot);
      this.names.set(projectId, projectName);
      return this.toSnapshot(session, projectName, localized.warnings);
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
      mimeType: extension === ".svg"
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
      documentUrl:
        `htmlstudio-project://${snapshot.projectId}/working/index.html`
    };
  }

  close(): void {
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
    this.roots.clear();
    this.names.clear();
  }
}
