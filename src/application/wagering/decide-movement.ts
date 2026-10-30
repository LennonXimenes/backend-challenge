import { Money } from "../../domain/money/money";
import { CurrencyMismatchError } from "../../domain/money/money-error";
import { InsufficientBalanceError } from "../../domain/wallet/wallet-error";
import { Wallet } from "../../domain/wallet/wallet";
import { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";
import { FailureCode } from "../../domain/wager/failure-code";
import { payloadHash } from "../../domain/wager/payload-hash";
import { InvalidTransactionStateError, WagerTransaction, WagerTransactionKind, WagerTransactionStatus } from "../../domain/wager/wager-transaction";

export interface ResolvedReference {
  id: string;
  kind: string;
  status: string;
  playerId: string;
  walletId: string;
  roundId: string;
  currency: string;
  amount: string;
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
  kind: WagerTransactionKind.Bet | WagerTransactionKind.Win | WagerTransactionKind.Loss | WagerTransactionKind.Refund;
  money: Wallet["balance"];
  referenceExternalTransactionId?: string;
  reference?: ResolvedReference;
  alreadyReversed?: boolean;
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

  if (input.kind === WagerTransactionKind.Refund) {
    return decideRefund(wallet, transaction, input);
  }

  if (input.kind === WagerTransactionKind.Loss && input.money.currency !== wallet.currency) {
    transaction.reject(FailureCode.CurrencyMismatch);
    return { transaction };
  }

  if ((input.kind === WagerTransactionKind.Win || input.kind === WagerTransactionKind.Loss) && input.referenceExternalTransactionId) {
    if (!input.reference) {
      transaction.markPendingReference();
      return { transaction };
    }

    if (!sameBet(input.reference, wallet, input.roundId)) {
      transaction.reject(FailureCode.InvalidReference);
      return { transaction };
    }
  }

  if (input.kind === WagerTransactionKind.Loss) {
    transaction.markProcessed(input.at, input.reference?.id);
    return { transaction };
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

function decideRefund(wallet: Wallet, transaction: WagerTransaction, input: MovementInput): MovementDecision {
  if (!input.referenceExternalTransactionId) {
    throw new InvalidTransactionStateError("REFUND requires a reference");
  }

  if (input.money.currency !== wallet.currency) {
    transaction.reject(FailureCode.CurrencyMismatch);
    return { transaction };
  }

  if (!input.reference) {
    transaction.markPendingReference();
    return { transaction };
  }

  if (!sameBet(input.reference, wallet, input.roundId)) {
    transaction.reject(FailureCode.InvalidReference);
    return { transaction };
  }

  if (!input.money.equals(Money.from({ amount: input.reference.amount, currency: input.reference.currency }))) {
    transaction.reject(FailureCode.AmountMismatch);
    return { transaction };
  }

  if (input.alreadyReversed) {
    transaction.reject(FailureCode.AlreadyReversed);
    return { transaction };
  }

  const entry = wallet.credit({
    money: input.money,
    at: input.at,
    ledgerId: input.ledgerId,
    transactionId: transaction.id,
  });
  transaction.markProcessed(input.at, input.reference.id);
  return { transaction, entry };
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
