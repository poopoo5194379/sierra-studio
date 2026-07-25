import {
  PdfExportOptionsSchema,
  type PdfExportResult
} from "../../domain/pdf/export-options";
import type { PdfRenderer } from "../ports/pdf-renderer";
import type { ProjectManager } from "../projects/project-manager";

export class PdfExportService {
  private running = false;
  constructor(
    private readonly projects: ProjectManager,
    private readonly renderer: PdfRenderer
  ) {}

  async export(
    projectId: string,
    outputPath: string,
    input: unknown
  ): Promise<PdfExportResult> {
    if (this.running) {
      throw new Error("A PDF export is already running");
    }
    const options = PdfExportOptionsSchema.parse(input);
    const source = this.projects.getPdfExportSource(projectId);
    this.running = true;
    try {
      return await this.renderer.render({
        documentUrl: source.documentUrl,
        outputPath,
        options
      });
    } finally {
      this.running = false;
    }
  }
}
