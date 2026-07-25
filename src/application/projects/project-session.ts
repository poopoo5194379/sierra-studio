import { createHash } from "node:crypto";
import {
  brotliCompress,
  brotliDecompress,
  constants as zlibConstants
} from "node:zlib";
import { promisify } from "node:util";
import { readFile, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  CommandEnvelopeSchema,
  invertPayload,
  type CommandEnvelope,
  type CommandPayload
} from "../../domain/commands/schema";
import { applyCommandToHtml } from "../../domain/document/html-document";
import { HtmlStudioError } from "../../shared/errors";
import { atomicWriteFile } from "../../infrastructure/filesystem/atomic-files";
import {
  ProjectDatabase,
  type AssetRecord,
  type StoredCheckpoint
} from "../../infrastructure/sqlite/project-database";

const compress = promisify(brotliCompress);
const decompress = promisify(brotliDecompress);
const CHECKPOINT_INTERVAL = 50;
const RECENT_CHECKPOINTS_TO_KEEP = 3;

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

function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export class ProjectSession {
  private html = "";
  private revision = 0;

  private constructor(
    readonly projectRoot: string,
    readonly projectId: string,
    readonly documentId: string,
    private readonly database: ProjectDatabase
  ) {}

  static async open(projectRoot: string): Promise<ProjectSession> {
    const database = new ProjectDatabase(join(projectRoot, "project.sqlite"));
    const projectId = database.getMetadata("project_id");
    const documentId = database.getMetadata("document_id");
    if (!projectId || !documentId) {
      database.close();
      throw new HtmlStudioError("Project metadata is incomplete", "BAD_PROJECT");
    }
    const session = new ProjectSession(
      projectRoot,
      projectId,
      documentId,
      database
    );
    await session.recover();
    return session;
  }

  static async create(
    projectRoot: string,
    projectId: string,
    documentId: string,
    initialHtml: string,
    assets: AssetRecord[] = []
  ): Promise<ProjectSession> {
    const database = new ProjectDatabase(join(projectRoot, "project.sqlite"));
    database.initializeMetadata({
      project_id: projectId,
      document_id: documentId,
      head_revision: "0",
      max_revision: "0"
    });
    const session = new ProjectSession(
      projectRoot,
      projectId,
      documentId,
      database
    );
    session.html = initialHtml;
    database.addAssets(assets);
    await session.writeCheckpoint(0);
    await session.materializeWorkingCopy();
    return session;
  }

  private async recover(): Promise<void> {
    const headRevision = Number(this.database.getMetadata("head_revision") ?? 0);
    const checkpoint = this.database.getLatestCheckpoint(headRevision);
    if (!checkpoint) {
      throw new HtmlStudioError("No recovery checkpoint found", "NO_CHECKPOINT");
    }
    this.html = await this.readAndVerifyCheckpoint(checkpoint);
    this.revision = checkpoint.revision;

    for (const stored of this.database.getOperationsAfter(this.revision, headRevision)) {
      const command = CommandEnvelopeSchema.parse(stored.command);
      if (command.baseRevision !== this.revision) {
        throw new HtmlStudioError(
          `Replay revision mismatch at ${command.commandId}`,
          "REPLAY_REVISION_MISMATCH"
        );
      }
      this.html = applyCommandToHtml(this.html, command.payload);
      this.revision = command.resultingRevision;
    }
    if (this.revision !== headRevision) {
      throw new HtmlStudioError(
        "Recovered revision does not match database head",
        "REPLAY_HEAD_MISMATCH"
      );
    }
    await this.materializeWorkingCopy();
  }

  private async readAndVerifyCheckpoint(
    checkpoint: StoredCheckpoint
  ): Promise<string> {
    const compressed = await readFile(join(this.projectRoot, checkpoint.relativePath));
    if (sha256(compressed) !== checkpoint.sha256) {
      throw new HtmlStudioError(
        `Checkpoint ${checkpoint.revision} failed hash verification`,
        "CHECKPOINT_HASH_MISMATCH"
      );
    }
    return (await decompress(compressed)).toString("utf8");
  }

  async execute(input: unknown): Promise<{ revision: number }> {
    const command = CommandEnvelopeSchema.parse(input);
    if (command.documentId !== this.documentId) {
      throw new HtmlStudioError("Command targets another document", "WRONG_DOCUMENT");
    }
    if (command.baseRevision !== this.revision) {
      throw new HtmlStudioError(
        `Expected revision ${this.revision}, received ${command.baseRevision}`,
        "REVISION_CONFLICT"
      );
    }

    const nextHtml = applyCommandToHtml(this.html, command.payload);
    const previousHtml = this.html;
    await this.materializeHtml(nextHtml);
    let abandonedCheckpoints: string[];
    try {
      abandonedCheckpoints = this.database.appendOperation(
        command,
        invertPayload(command.payload)
      );
    } catch (error) {
      await this.materializeHtml(previousHtml);
      throw error;
    }
    this.html = nextHtml;
    this.revision = command.resultingRevision;
    await this.removeCheckpointFiles(abandonedCheckpoints).catch(() => undefined);
    if (this.revision % CHECKPOINT_INTERVAL === 0) {
      await this.writeCheckpoint(this.revision);
    }
    return { revision: this.revision };
  }

  async undo(): Promise<{ revision: number; inverse: CommandPayload | null }> {
    if (this.revision === 0) return { revision: 0, inverse: null };
    // Capture the inverse of the operation being undone BEFORE we restore
    // (after restore the head_revision moves and the operation is no longer
    //  the "last" one).
    const inverse = this.database.getInverseAt(this.revision);
    await this.restoreToRevision(this.revision - 1);
    return { revision: this.revision, inverse };
  }

  async redo(): Promise<{ revision: number; forward: CommandPayload | null }> {
    const maxRevision = Number(this.database.getMetadata("max_revision") ?? 0);
    if (this.revision >= maxRevision) return { revision: this.revision, forward: null };
    // Capture the forward payload of the operation we're about to re-apply.
    const forward = this.database.getPayloadAt(this.revision + 1);
    await this.restoreToRevision(this.revision + 1);
    return { revision: this.revision, forward };
  }

  private async restoreToRevision(targetRevision: number): Promise<void> {
    const checkpoint = this.database.getLatestCheckpoint(targetRevision);
    if (!checkpoint) {
      throw new HtmlStudioError("No checkpoint for requested revision", "NO_CHECKPOINT");
    }
    let html = await this.readAndVerifyCheckpoint(checkpoint);
    let revision = checkpoint.revision;
    for (const stored of this.database.getOperationsAfter(revision, targetRevision)) {
      const command = CommandEnvelopeSchema.parse(stored.command);
      if (command.baseRevision !== revision) {
        throw new HtmlStudioError(
          `Replay revision mismatch at ${command.commandId}`,
          "REPLAY_REVISION_MISMATCH"
        );
      }
      html = applyCommandToHtml(html, command.payload);
      revision = command.resultingRevision;
    }
    if (revision !== targetRevision) {
      throw new HtmlStudioError("Target revision cannot be reconstructed", "BAD_REVISION");
    }
    this.html = html;
    this.revision = revision;
    this.database.setHeadRevision(revision);
    await this.materializeWorkingCopy();
  }

  private async materializeWorkingCopy(): Promise<void> {
    await this.materializeHtml(this.html);
  }

  private async materializeHtml(html: string): Promise<void> {
    await atomicWriteFile(
      join(this.projectRoot, "working", "index.html"),
      html
    );
  }

  private async writeCheckpoint(revision: number): Promise<void> {
    const compressed = await compress(Buffer.from(this.html, "utf8"), {
      params: {
        // Quality 11 can take minutes for image-heavy 20–50 MB HTML files.
        // Quality 4 keeps checkpoints compact while remaining interactive.
        [zlibConstants.BROTLI_PARAM_QUALITY]: 4
      }
    });
    const target = join(
      this.projectRoot,
      "snapshots",
      `checkpoint-${String(revision).padStart(8, "0")}.br`
    );
    await atomicWriteFile(target, compressed);
    this.database.addCheckpoint({
      revision,
      relativePath: relative(this.projectRoot, target),
      sha256: sha256(compressed)
    });
    await this.removeCheckpointFiles(
      this.database.pruneCheckpoints(RECENT_CHECKPOINTS_TO_KEEP)
    ).catch(() => undefined);
  }

  private async removeCheckpointFiles(relativePaths: string[]): Promise<void> {
    for (const relativePath of relativePaths) {
      const targetPath = resolve(this.projectRoot, relativePath);
      const pathFromRoot = relative(this.projectRoot, targetPath);
      if (
        pathFromRoot.startsWith("..")
        || isAbsolute(pathFromRoot)
        || !pathFromRoot.replaceAll("\\", "/").startsWith("snapshots/")
      ) {
        throw new HtmlStudioError(
          "Unsafe checkpoint path rejected",
          "UNSAFE_CHECKPOINT_PATH"
        );
      }
      await rm(targetPath, { force: true });
    }
  }

  snapshot(): {
    projectId: string;
    documentId: string;
    revision: number;
    html: string;
  } {
    return {
      projectId: this.projectId,
      documentId: this.documentId,
      revision: this.revision,
      html: this.html
    };
  }

  addAsset(asset: AssetRecord): void {
    this.database.addAssets([asset]);
  }

  close(): void {
    this.database.close();
  }
}
