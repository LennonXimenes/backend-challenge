import { Money } from "../money/money";
import { payloadHash } from "./payload-hash";

export const OPENING_PROVIDER_ID = "internal";
export const OPENING_ROUND_ID = "opening";
export const OPENING_GAME_ID = "opening";

export enum WagerTransactionKind {
  Opening = "OPENING",
  Bet = "BET",
  Win = "WIN",
  Loss = "LOSS",
  Refund = "REFUND",
  Rollback = "ROLLBACK",
}

export enum WagerTransactionStatus {
  Pending = "PENDING",
  PendingReference = "PENDING_REFERENCE",
  Processed = "PROCESSED",
  Rejected = "REJECTED",
  Failed = "FAILED",
}

export class InvalidTransactionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransactionStateError";
  }
}

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
  status: WagerTransactionStatus;
  processedAt?: Date;
}

export class WagerTransaction {
  private constructor(
    readonly id: string,
    readonly providerId: string,
    readonly externalTransactionId: string,
    readonly idempotencyKey: string,
    readonly payloadHash: string,
    readonly walletId: string,
    readonly playerId: string,
    readonly roundId: string,
    readonly gameId: string,
    readonly kind: WagerTransactionKind,
    readonly money: Money,
    readonly referenceExternalTransactionId: string | undefined,
    readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _processedAt?: Date,
  ) {}

  static opening(props: {
    id: string;
    walletId: string;
    playerId: string;
    money: Money;
    at: Date;
  }): WagerTransaction {
    const transaction = new WagerTransaction(
      props.id,
      OPENING_PROVIDER_ID,
      props.walletId,
      `internal:opening:${props.walletId}`,
      payloadHash({
        gameId: OPENING_GAME_ID,
        kind: WagerTransactionKind.Opening,
        money: props.money.toJSON(),
        playerId: props.playerId,
        roundId: OPENING_ROUND_ID,
        walletId: props.walletId,
      }),
      props.walletId,
      props.playerId,
      OPENING_ROUND_ID,
      OPENING_GAME_ID,
      WagerTransactionKind.Opening,
      props.money,
      undefined,
      props.at,
      WagerTransactionStatus.Pending,
    );

    transaction.markProcessed(props.at);
    return transaction;
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.processedAt,
    );
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  markProcessed(at: Date): void {
    this.assertOpen();
    this._status = WagerTransactionStatus.Processed;
    this._processedAt = at;
  }

  private assertOpen(): void {
    if (this._status !== WagerTransactionStatus.Pending && this._status !== WagerTransactionStatus.PendingReference) {
      throw new InvalidTransactionStateError(`cannot transition ${this._status}`);
    }
  }
}
