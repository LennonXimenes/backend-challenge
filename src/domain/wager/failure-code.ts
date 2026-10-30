export const FailureCode = {
  InsufficientBalance: "INSUFFICIENT_BALANCE",
  CurrencyMismatch: "CURRENCY_MISMATCH",
  InvalidReference: "INVALID_REFERENCE",
  PlayerMismatch: "PLAYER_MISMATCH",
  AmountMismatch: "AMOUNT_MISMATCH",
  AlreadyReversed: "ALREADY_REVERSED",
  ReferenceNotFound: "REFERENCE_NOT_FOUND",
  ReversalExceedsBalance: "REVERSAL_EXCEEDS_BALANCE",
} as const;
