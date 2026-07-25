export class HtmlStudioError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "HtmlStudioError";
  }
}

export const asErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
