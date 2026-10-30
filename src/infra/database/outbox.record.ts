import { defineEntity, p } from "@mikro-orm/core";
import { OutboxMessage } from "../../domain/integration/outbox-message";

export class OutboxRecord {
  id!: string;
  aggregateId!: string;
  eventType!: string;
  payload!: Record<string, unknown>;
  occurredAt!: Date;
  attempts!: number;
  nextAttemptAt!: Date | null;
  publishedAt!: Date | null;
}

export const OutboxRecordSchema = defineEntity({
  class: OutboxRecord,
  tableName: "outbox_messages",
  properties: {
    id: p.uuid().primary(),
    aggregateId: p.uuid().fieldName("aggregate_id"),
    eventType: p.string().fieldName("event_type"),
    payload: p.json<Record<string, unknown>>().columnType("jsonb"),
    occurredAt: p.datetime().columnType("timestamptz").fieldName("occurred_at"),
    attempts: p.integer(),
    nextAttemptAt: p.datetime().nullable().columnType("timestamptz").fieldName("next_attempt_at"),
    publishedAt: p.datetime().nullable().columnType("timestamptz").fieldName("published_at"),
  },
});

export function outboxRecordFrom(message: OutboxMessage): OutboxRecord {
  const record = new OutboxRecord();
  record.id = message.id;
  record.aggregateId = message.aggregateId;
  record.eventType = message.eventType;
  record.payload = { ...message.payload };
  record.occurredAt = message.occurredAt;
  record.attempts = message.attempts;
  record.nextAttemptAt = message.nextAttemptAt ?? null;
  record.publishedAt = message.publishedAt ?? null;
  return record;
}

export function persistOutbox(em: { persist(entity: OutboxRecord): unknown }, messages: readonly OutboxMessage[]): void {
  for (const message of messages) {
    em.persist(outboxRecordFrom(message));
  }
}
