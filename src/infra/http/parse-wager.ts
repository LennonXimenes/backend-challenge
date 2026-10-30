import { Money } from "../../domain/money/money";
import { InvalidWalletInputError } from "../../domain/wallet/wallet-error";
import { WagerTransactionKind } from "../../domain/wager/wager-transaction";
import type { SubmitWagerCommand } from "../../application/wagering/submit-wager";

export function parseWagerBody(body: unknown, idempotencyKey: string | undefined): SubmitWagerCommand {
  if (!idempotencyKey || idempotencyKey.trim() === "") {
    throw new InvalidWalletInputError("Idempotency-Key is required");
  }

  if (!body || typeof body !== "object") {
    throw new InvalidWalletInputError("body is required");
  }

  const record = body as Record<string, unknown>;
  const money = record.money;
  if (!money || typeof money !== "object") {
    throw new InvalidWalletInputError("money is required");
  }

  const amount = (money as Record<string, unknown>).amount;
  const currency = (money as Record<string, unknown>).currency;
  const required = ["providerId", "externalTransactionId", "playerId", "walletId", "roundId", "gameId", "kind"] as const;
  for (const field of required) {
    if (typeof record[field] !== "string" || record[field] === "") {
      throw new InvalidWalletInputError(`${field} is required`);
    }
  }

  if (typeof amount !== "string" || typeof currency !== "string") {
    throw new InvalidWalletInputError("money amount and currency must be strings");
  }

  if (
    record.kind !== WagerTransactionKind.Bet &&
    record.kind !== WagerTransactionKind.Win &&
    record.kind !== WagerTransactionKind.Loss &&
    record.kind !== WagerTransactionKind.Refund
  ) {
    throw new InvalidWalletInputError("kind must be BET, WIN, LOSS or REFUND");
  }

  const reference = record.referenceExternalTransactionId;
  if (reference !== undefined && typeof reference !== "string") {
    throw new InvalidWalletInputError("referenceExternalTransactionId must be a string");
  }

  if (record.kind === WagerTransactionKind.Bet && reference) {
    throw new InvalidWalletInputError("BET does not accept a reference");
  }

  if (record.kind === WagerTransactionKind.Refund && (typeof reference !== "string" || reference === "")) {
    throw new InvalidWalletInputError("REFUND requires referenceExternalTransactionId");
  }

  const parsedMoney = Money.from({ amount, currency });
  if (parsedMoney.isZero()) {
    throw new InvalidWalletInputError("amount must be positive");
  }

  return {
    providerId: record.providerId as string,
    externalTransactionId: record.externalTransactionId as string,
    idempotencyKey,
    playerId: record.playerId as string,
    walletId: record.walletId as string,
    roundId: record.roundId as string,
    gameId: record.gameId as string,
    kind: record.kind,
    money: parsedMoney,
    referenceExternalTransactionId: reference,
  };
}
