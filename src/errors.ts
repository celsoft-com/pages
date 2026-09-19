// A write refused because what it was built on has moved. Every other tool failure is the caller
// asking for something impossible; this one is the caller asking for something that was possible
// when they read it. A service retrying on a schedule has to tell those apart without reading the
// sentence, which is why the type exists at all: the REST surface maps it to 409 and everything
// else to 400. The message is unchanged either way, so MCP cannot tell the difference.
export class ConflictError extends Error {
  readonly conflict = true;
}

export function isConflict(error: unknown): boolean {
  return error instanceof ConflictError;
}
