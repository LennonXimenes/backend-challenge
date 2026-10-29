export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMoneyError";
  }
}

export class CurrencyMismatchError extends Error {
  constructor(left: string, right: string) {
    super(`currency mismatch: ${left} and ${right}`);
    this.name = "CurrencyMismatchError";
  }
}
