import type { LeasedOutboxEvent } from "./outbox-store";

export interface IntegrationEventSink {
  publish(event: LeasedOutboxEvent): Promise<void>;
}
