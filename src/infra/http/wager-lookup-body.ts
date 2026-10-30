import type { WagerLookup } from "../../application/wagering/wager-repository";

export function wagerLookupBody(stored: WagerLookup): {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: { amount: string; currency: string };
  status: string;
  failureCode: string | null;
  balance: { amount: string; currency: string };
  referenceExternalTransactionId: string | null;
  createdAt: string;
  processedAt: string | null;
} {
  const transaction = stored.transaction;
  return {
    transactionId: transaction.id,
    providerId: transaction.providerId,
    externalTransactionId: transaction.externalTransactionId,
    playerId: transaction.playerId,
    walletId: transaction.walletId,
    roundId: transaction.roundId,
    gameId: transaction.gameId,
    kind: transaction.kind,
    money: transaction.money.toJSON(),
    status: transaction.status,
    failureCode: transaction.failureCode ?? null,
    balance: stored.balance,
    referenceExternalTransactionId: transaction.referenceExternalTransactionId ?? null,
    createdAt: transaction.createdAt.toISOString(),
    processedAt: transaction.processedAt?.toISOString() ?? null,
  };
}
