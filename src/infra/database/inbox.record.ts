import { defineEntity, p } from "@mikro-orm/core";
import { InboxMessage } from "../../domain/inbox/inbox-message";

export class InboxRecord {
  consumerName!: string;
  messageId!: string;
  payloadHash!: string;
  receivedAt!: Date;
  processedAt!: Date | null;
}

export const InboxRecordSchema = defineEntity({
  class: InboxRecord,
  tableName: "inbox_messages",
  properties: {
    consumerName: p.string().fieldName("consumer_name").primary(),
    messageId: p.string().fieldName("message_id").primary(),
    payloadHash: p.string().fieldName("payload_hash"),
    receivedAt: p.datetime().columnType("timestamptz").fieldName("received_at"),
    processedAt: p.datetime().nullable().columnType("timestamptz").fieldName("processed_at"),
  },
});

export function inboxRecordFrom(message: InboxMessage): InboxRecord {
  const record = new InboxRecord();
  record.consumerName = message.consumerName;
  record.messageId = message.messageId;
  record.payloadHash = message.payloadHash;
  record.receivedAt = message.receivedAt;
  record.processedAt = message.processedAt ?? null;
  return record;
}
