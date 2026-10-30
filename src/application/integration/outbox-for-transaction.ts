import { OutboxMessage } from "../../domain/integration/outbox-message";
import { WalletBalanceChanged } from "../../domain/integration/wallet-balance-changed";
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
} from "../../domain/integration/wager-transaction-events";
import type { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";
import type { Wallet } from "../../domain/wallet/wallet";
import { InvalidTransactionStateError, WagerTransaction, WagerTransactionStatus } from "../../domain/wager/wager-transaction";

export function outboxForTransaction(input: {
  transaction: WagerTransaction;
  wallet: Wallet;
  entry?: WalletLedgerEntry;
  eventId: string;
  balanceEventId?: string;
  occurredAt: Date;
}): OutboxMessage[] {
  const transaction = input.transaction;
  const context = {
    eventId: input.eventId,
    correlationId: transaction.id,
    occurredAt: input.occurredAt,
  };

  if (input.entry && input.entry.transactionId !== transaction.id) {
    throw new InvalidTransactionStateError("ledger entry belongs to another transaction");
  }

  if (transaction.status === WagerTransactionStatus.Processed) {
    const messages = [OutboxMessage.enqueue(WagerTransactionProcessed.from(transaction, input.wallet, context))];
    if (input.entry) {
      if (!input.balanceEventId) {
        throw new InvalidTransactionStateError("balance event id is required");
      }
      messages.push(OutboxMessage.enqueue(WalletBalanceChanged.from(input.wallet, input.entry, {
        ...context,
        eventId: input.balanceEventId,
      })));
    }
    return messages;
  }

  if (input.entry) {
    throw new InvalidTransactionStateError("only a processed transaction can carry a ledger entry");
  }

  if (transaction.status === WagerTransactionStatus.Rejected) {
    return [OutboxMessage.enqueue(WagerTransactionRejected.from(transaction, input.wallet, context))];
  }

  if (transaction.status === WagerTransactionStatus.PendingReference) {
    return [OutboxMessage.enqueue(WagerTransactionPendingReference.from(transaction, input.wallet, context))];
  }

  throw new InvalidTransactionStateError(`cannot enqueue ${transaction.status}`);
}
