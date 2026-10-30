export class WagerConflictError extends Error {
  constructor() {
    super("wager transaction conflict");
    this.name = "WagerConflictError";
  }
}
