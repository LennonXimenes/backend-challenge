import { Money } from "../../domain/money/money";
import { InvalidWalletInputError } from "../../domain/wallet/wallet-error";

export function parseOpenWalletBody(body: unknown): { playerId: string; initialBalance: Money } {
  if (!body || typeof body !== "object") {
    throw new InvalidWalletInputError("body is required");
  }

  const record = body as Record<string, unknown>;
  const balance = record.initialBalance;
  if (typeof record.playerId !== "string" || !balance || typeof balance !== "object") {
    throw new InvalidWalletInputError("playerId and initialBalance are required");
  }

  const money = balance as Record<string, unknown>;
  if (typeof money.amount !== "string" || typeof money.currency !== "string") {
    throw new InvalidWalletInputError("initialBalance amount and currency must be strings");
  }

  return {
    playerId: record.playerId,
    initialBalance: Money.from({ amount: money.amount, currency: money.currency }),
  };
}
