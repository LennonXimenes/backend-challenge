import { CurrencyMismatchError } from "../../domain/money/money-error";
import { InsufficientBalanceError } from "../../domain/wallet/wallet-error";
import { Wallet } from "../../domain/wallet/wallet";
import { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";
import { FailureCode } from "../../domain/wager/failure-code";
import { payloadHash } from "../../domain/wager/payload-hash";
import { WagerTransaction, WagerTransactionKind, WagerTransactionStatus } from "../../domain/wager/wager-transaction";

export interface ResolvedReference {
  id: string;
  kind: string;
  status: string;
  playerId: string;
  walletId: string;
  roundId: string;
  currency: string;
}

export interface MovementInput {
  transactionId: string;
  ledgerId: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind.Bet | WagerTransactionKind.Win;
  money: Wallet["balance"];
  referenceExternalTransactionId?: string;
  reference?: ResolvedReference;
  at: Date;
}

export interface MovementDecision {
  transaction: WagerTransaction;
  entry?: WalletLedgerEntry;
}

export function movementPayloadHash(input: Pick<
  MovementInput,
  | "externalTransactionId"
  | "gameId"
  | "kind"
  | "money"
  | "playerId"
  | "providerId"
  | "referenceExternalTransactionId"
  | "roundId"
  | "walletId"
>): string {
  return payloadHash({
    externalTransactionId: input.externalTransactionId,
    gameId: input.gameId,
    kind: input.kind,
    money: input.money.toJSON(),
    playerId: input.playerId,
    providerId: input.providerId,
    referenceExternalTransactionId: input.referenceExternalTransactionId,
    roundId: input.roundId,
    walletId: input.walletId,
  });
}

export function decideMovement(wallet: Wallet, input: MovementInput): MovementDecision {
  const transaction = WagerTransaction.create({
    id: input.transactionId,
    providerId: input.providerId,
    externalTransactionId: input.externalTransactionId,
    idempotencyKey: input.idempotencyKey,
    payloadHash: movementPayloadHash(input),
    walletId: input.walletId,
    playerId: input.playerId,
    roundId: input.roundId,
    gameId: input.gameId,
    kind: input.kind,
    money: input.money,
    referenceExternalTransactionId: input.referenceExternalTransactionId,
    createdAt: input.at,
  });

  if (input.playerId !== wallet.playerId) {
    transaction.reject(FailureCode.PlayerMismatch);
    return { transaction };
  }

  if (input.kind === WagerTransactionKind.Win && input.referenceExternalTransactionId) {
    if (!input.reference) {
      transaction.markPendingReference();
      return { transaction };
    }

    if (!sameBet(input.reference, wallet, input.roundId)) {
      transaction.reject(FailureCode.InvalidReference);
      return { transaction };
    }
  }

  try {
    const movement = { money: input.money, at: input.at, ledgerId: input.ledgerId, transactionId: transaction.id };
    const entry = input.kind === WagerTransactionKind.Bet ? wallet.debit(movement) : wallet.credit(movement);
    transaction.markProcessed(input.at, input.reference?.id);
    return { transaction, entry };
  } catch (error) {
    if (error instanceof InsufficientBalanceError) {
      transaction.reject(FailureCode.InsufficientBalance);
      return { transaction };
    }

    if (error instanceof CurrencyMismatchError) {
      transaction.reject(FailureCode.CurrencyMismatch);
      return { transaction };
    }

    throw error;
  }
}

function sameBet(reference: ResolvedReference, wallet: Wallet, roundId: string): boolean {
  return (
    reference.kind === WagerTransactionKind.Bet &&
    reference.status === WagerTransactionStatus.Processed &&
    reference.playerId === wallet.playerId &&
    reference.walletId === wallet.id &&
    reference.roundId === roundId &&
    reference.currency === wallet.currency
  );
}
