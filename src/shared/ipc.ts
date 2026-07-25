import type { CommandEnvelope, CommandPayload } from "../domain/commands/schema";
import type {
  PdfExportOptions,
  PdfExportResult
} from "../domain/pdf/export-options";

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

export const IPC_CHANNELS = {
  importHtml: "project:import-html",
  executeCommand: "project:execute-command",
  exportStatic: "project:export-static",
  importImage: "project:import-image",
  undo: "project:undo",
  redo: "project:redo",
  exportPdf: "project:export-pdf",
  checkForUpdate: "app:check-for-update",
  quitAndInstall: "app:quit-and-install"
} as const;

export interface DesktopApi {
  importHtml(): Promise<{
    canceled: boolean;
    project?: {
      projectId: string;
      documentId: string;
      revision: number;
      documentUrl: string;
      name: string;
      warnings: string[];
    };
    error?: string;
  }>;
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
    assetPath?: string;
  }>;
  undo(projectId: string): Promise<UndoRedoResult>;
  redo(projectId: string): Promise<UndoRedoResult>;
  exportPdf(input: {
    projectId: string;
    options: PdfExportOptions;
  }): Promise<{
    canceled: boolean;
    result?: PdfExportResult;
    error?: string;
  }>;
}
