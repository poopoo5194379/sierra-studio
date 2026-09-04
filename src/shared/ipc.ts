import type { CommandEnvelope, CommandPayload } from "../domain/commands/schema";
import type {
  PdfExportOptions,
  PdfExportResult
} from "../domain/pdf/export-options";
import type {
  PptxExportOptions,
  PptxExportResult
} from "../domain/pptx/export-options";
import type { ImportCompatibilityReport } from "./import-compatibility";
import type { ProjectFeatures } from "./project-features";

export interface UndoRedoResult {
  revision: number;
  /**
   * For undo: the inverse command to apply in-place on the live DOM.
   * For redo: the forward command to re-apply in-place.
   * null when at the boundary (nothing to undo/redo).
   */
  inverse?: CommandPayload | null;
  forward?: CommandPayload | null;
}

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

export interface ProjectSummary {
  projectId: string;
  name: string;
  importedAt: string;
}

export const IPC_CHANNELS = {
  importHtml: "project:import-html",
  ensureWelcomeProject: "project:ensure-welcome",
  listProjects: "project:list",
  openProject: "project:open",
  executeCommand: "project:execute-command",
  exportStatic: "project:export-static",
  importImage: "project:import-image",
  importImages: "project:import-images",
  importMedia: "project:import-media",
  materializeProject: "project:materialize",
  undo: "project:undo",
  redo: "project:redo",
  updateFeatures: "project:update-features",
  exportPdf: "project:export-pdf",
  exportPptx: "project:export-pptx",
  operationProgress: "operation:progress",
  checkForUpdate: "app:check-for-update",
  quitAndInstall: "app:quit-and-install"
} as const;

export interface DesktopApi {
  onOperationProgress(
    listener: (event: { active: boolean; label?: string }) => void
  ): () => void;
  importHtml(): Promise<{
    canceled: boolean;
    project?: ProjectSnapshot;
    error?: string;
  }>;
  ensureWelcomeProject(): Promise<ProjectSnapshot>;
  listProjects(): Promise<ProjectSummary[]>;
  openProject(projectId: string): Promise<ProjectSnapshot>;
  executeCommand(input: {
    projectId: string;
    command: CommandEnvelope;
  }): Promise<{
    revision: number;
  }>;
  exportStatic(projectId: string): Promise<{
    canceled: boolean;
    exportPath?: string;
  }>;
  importImage(projectId: string): Promise<{
    canceled: boolean;
    imageSource?: string;
  }>;
  importImages(projectId: string): Promise<{
    canceled: boolean;
    images?: Array<{
      imageSource: string;
      originalName: string;
    }>;
  }>;
  importMedia(
    projectId: string,
    mediaType: "image" | "video"
  ): Promise<{
    canceled: boolean;
    assetPath?: string;
    originalName?: string;
  }>;
  undo(projectId: string): Promise<UndoRedoResult>;
  redo(projectId: string): Promise<UndoRedoResult>;
  updateProjectFeatures(input: {
    projectId: string;
    features: ProjectFeatures;
  }): Promise<ProjectFeatures>;
  exportPdf(input: {
    projectId: string;
    options: PdfExportOptions;
  }): Promise<{
    canceled: boolean;
    result?: PdfExportResult;
    error?: string;
  }>;
  exportPptx(input: {
    projectId: string;
    options: PptxExportOptions;
  }): Promise<{
    canceled: boolean;
    result?: PptxExportResult;
    error?: string;
  }>;
  materializeProject(input: {
    projectId: string;
    html: string;
  }): Promise<ProjectSnapshot>;
  checkForUpdate(): Promise<{
    updateAvailable: boolean;
    version?: string;
  }>;
  quitAndInstall(): void;
}
