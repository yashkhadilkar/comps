// Errors that retrying cannot fix (bad credentials, missing config, not found). The tool executor
// returns these to the model right away instead of waiting and trying again.
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}
