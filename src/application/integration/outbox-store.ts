export interface LeasedOutboxEvent {
  id: string;
  aggregateId: string;
  payload: Readonly<Record<string, unknown>>;
}

export abstract class OutboxStore {
  abstract lease(now: Date): Promise<LeasedOutboxEvent | undefined>;

  abstract markPublished(id: string, at: Date): Promise<void>;
}
