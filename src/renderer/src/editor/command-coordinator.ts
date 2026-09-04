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
  private generation = 0;

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
    const generation = this.generation;
    this.queue = this.queue.then(async () => {
      if (generation !== this.generation) return;
      const baseRevision = this.getRevision();
      const result = await this.execute(context, payload, baseRevision);
      this.setRevision(result.revision);
      this.onCommitted(result.revision);
    }).catch((error: unknown) => {
      this.generation += 1;
      this.onFailed(error);
    });
  }

  waitForIdle(): Promise<void> {
    return this.queue;
  }
}
