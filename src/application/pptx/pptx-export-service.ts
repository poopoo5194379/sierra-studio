import {
  PptxExportOptionsSchema,
  type PptxExportResult
} from "../../domain/pptx/export-options";
import type { PptxRenderer } from "../ports/pptx-renderer";
import type { ProjectManager } from "../projects/project-manager";

export class PptxExportService {
  private running = false;

  constructor(
    private readonly projects: ProjectManager,
    private readonly renderer: PptxRenderer
  ) {}

  async export(
    projectId: string,
    outputPath: string,
    input: unknown
  ): Promise<PptxExportResult> {
    if (this.running) {
      throw new Error("A PowerPoint export is already running");
    }
    const options = PptxExportOptionsSchema.parse(input);
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
