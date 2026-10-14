/** Only deliberate, non-sensitive guidance may be returned through MCP. */
export class PublicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicError";
  }
}

export function toolErrorMessage(error: unknown): string {
  return error instanceof PublicError
    ? error.message
    : "Operation failed. Check server configuration and retry after inspecting resource state.";
}
