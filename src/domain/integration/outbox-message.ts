import type { IntegrationEvent } from "./integration-event";

const RETRY_BASE_MS = 1000;
const RETRY_CAP_MS = 60_000;

export class InvalidOutboxStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOutboxStateError";
  }
}

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
}

export class OutboxMessage {
  private constructor(
    readonly id: string,
    readonly aggregateId: string,
    readonly eventType: string,
    readonly payload: Readonly<Record<string, unknown>>,
    readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt?: Date,
    private _publishedAt?: Date,
  ) {}

  static enqueue<T>(event: IntegrationEvent<T>): OutboxMessage {
    return new OutboxMessage(
      event.eventId,
      event.aggregateId,
      event.eventType,
      event.toJSON() as unknown as Readonly<Record<string, unknown>>,
      event.occurredAt,
      0,
    );
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    return this.isPending() && (this._nextAttemptAt === undefined || this._nextAttemptAt.getTime() <= now.getTime());
  }

  markPublished(at: Date): void {
    this.assertPending();
    this._publishedAt = at;
  }

  scheduleRetry(now: Date): void {
    this.assertPending();
    const delayMs = Math.min(RETRY_BASE_MS * 2 ** this._attempts, RETRY_CAP_MS);
    this._attempts += 1;
    this._nextAttemptAt = new Date(now.getTime() + delayMs);
  }

  private assertPending(): void {
    if (this._publishedAt) {
      throw new InvalidOutboxStateError("outbox message is already published");
    }
  }
}
