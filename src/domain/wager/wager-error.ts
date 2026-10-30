export class WagerConflictError extends Error {
  constructor() {
    super("wager transaction conflict");
    this.name = "WagerConflictError";
  }
}

export class TransactionNotFoundError extends Error {
  constructor(transactionId: string) {
    super(`transaction not found: ${transactionId}`);
    this.name = "TransactionNotFoundError";
  }
}
