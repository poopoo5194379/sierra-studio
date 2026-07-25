import type { CommandPayload } from "../../../domain/commands/schema";

export interface CommandContext {
  projectId: string;
  documentId: string;
}

export interface CommandCommitResult {
  revision: number;
}

export class CommandCoordinator {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly getRevision: () => number,
    private readonly setRevision: (revision: number) => void,
    private readonly execute: (
      context: CommandContext,
      payload: CommandPayload,
      baseRevision: number
    ) => Promise<CommandCommitResult>,
    private readonly onCommitted: (revision: number) => void,
    private readonly onFailed: (error: unknown) => void
  ) {}

  enqueue(context: CommandContext, payload: CommandPayload): void {
    this.queue = this.queue.then(async () => {
      const baseRevision = this.getRevision();
      const result = await this.execute(context, payload, baseRevision);
      this.setRevision(result.revision);
      this.onCommitted(result.revision);
    }).catch((error: unknown) => {
      this.onFailed(error);
    });
  }

  waitForIdle(): Promise<void> {
    return this.queue;
  }
}
