export class UnbalancedLedgerEntryError extends Error {
  constructor() {
    super("ledger entry does not balance");
    this.name = "UnbalancedLedgerEntryError";
  }
}

export class InvalidWalletInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWalletInputError";
  }
}

export class WalletAlreadyExistsError extends Error {
  constructor(playerId: string, currency: string) {
    super(`wallet already exists for ${playerId} ${currency}`);
    this.name = "WalletAlreadyExistsError";
  }
}

export class InsufficientBalanceError extends Error {
  constructor() {
    super("insufficient balance");
    this.name = "InsufficientBalanceError";
  }
}

export class WalletNotFoundError extends Error {
  constructor(walletId: string) {
    super(`wallet not found: ${walletId}`);
    this.name = "WalletNotFoundError";
  }
}
