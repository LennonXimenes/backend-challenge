import type { MoneyProps } from "../money/money";
import type { Wallet } from "../wallet/wallet";
import { InvalidTransactionStateError, WagerTransaction, WagerTransactionStatus } from "../wager/wager-transaction";
import { IntegrationEvent, type EventContext, type IntegrationEventProps } from "./integration-event";

interface WagerEventData {
  transactionId: string;
  walletId: string;
  playerId: string;
  providerId: string;
  externalTransactionId: string;
  kind: string;
  money: MoneyProps;
  balance: MoneyProps;
}

export interface WagerTransactionProcessedData extends WagerEventData {
  walletVersion: number;
}

export interface WagerTransactionRejectedData extends WagerEventData {
  failureCode: string;
}

export interface WagerTransactionPendingReferenceData extends WagerEventData {
  referenceExternalTransactionId: string;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = "WagerTransactionProcessed";
  readonly version = 1;

  private constructor(props: IntegrationEventProps<WagerTransactionProcessedData>) {
    super(props);
  }

  static from(transaction: WagerTransaction, wallet: Wallet, ctx: EventContext): WagerTransactionProcessed {
    if (transaction.status !== WagerTransactionStatus.Processed) {
      throw new InvalidTransactionStateError("processed event requires a processed transaction");
    }

    return new WagerTransactionProcessed({
      eventId: ctx.eventId,
      aggregateId: transaction.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.occurredAt,
      data: {
        ...wagerData(transaction, wallet),
        walletVersion: wallet.version,
      },
    });
  }
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = "WagerTransactionRejected";
  readonly version = 1;

  private constructor(props: IntegrationEventProps<WagerTransactionRejectedData>) {
    super(props);
  }

  static from(transaction: WagerTransaction, wallet: Wallet, ctx: EventContext): WagerTransactionRejected {
    if (transaction.status !== WagerTransactionStatus.Rejected || !transaction.failureCode) {
      throw new InvalidTransactionStateError("rejected event requires a failure code");
    }

    return new WagerTransactionRejected({
      eventId: ctx.eventId,
      aggregateId: transaction.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.occurredAt,
      data: {
        ...wagerData(transaction, wallet),
        failureCode: transaction.failureCode,
      },
    });
  }
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = "WagerTransactionPendingReference";
  readonly version = 1;

  private constructor(props: IntegrationEventProps<WagerTransactionPendingReferenceData>) {
    super(props);
  }

  static from(transaction: WagerTransaction, wallet: Wallet, ctx: EventContext): WagerTransactionPendingReference {
    if (transaction.status !== WagerTransactionStatus.PendingReference || !transaction.referenceExternalTransactionId) {
      throw new InvalidTransactionStateError("pending event requires the missing reference");
    }

    return new WagerTransactionPendingReference({
      eventId: ctx.eventId,
      aggregateId: transaction.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.occurredAt,
      data: {
        ...wagerData(transaction, wallet),
        referenceExternalTransactionId: transaction.referenceExternalTransactionId,
      },
    });
  }
}

function wagerData(transaction: WagerTransaction, wallet: Wallet): WagerEventData {
  return {
    transactionId: transaction.id,
    walletId: wallet.id,
    playerId: transaction.playerId,
    providerId: transaction.providerId,
    externalTransactionId: transaction.externalTransactionId,
    kind: transaction.kind,
    money: transaction.money.toJSON(),
    balance: wallet.balance.toJSON(),
  };
}
