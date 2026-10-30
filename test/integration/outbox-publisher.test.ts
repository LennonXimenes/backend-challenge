import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CreateQueueCommand, DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { MikroORM } from "@mikro-orm/postgresql";
import type { LeasedOutboxEvent } from "../../src/application/integration/outbox-store";
import { OutboxPublisher } from "../../src/application/integration/outbox-publisher";
import { initOrm } from "../../src/infra/database/orm-config";
import { OutboxRecord } from "../../src/infra/database/outbox.record";
import { INTEGRATION_EVENT_CONSUMER, SqlIntegrationEventInbox } from "../../src/infra/database/sql-integration-inbox";
import { SqlOutboxStore } from "../../src/infra/database/sql-outbox-store";
import { InboxRecord } from "../../src/infra/database/inbox.record";
import { SqsIntegrationEventSink } from "../../src/infra/sqs/sqs-event-sink";

const adminUrl = "postgres://wagering:wagering@localhost:5432/postgres";
const databaseUrl = "postgres://wagering:wagering@localhost:5432/wagering_outbox";
const endpoint = "http://localhost:4566";
const now = new Date("2026-10-30T15:00:00.000Z");

let orm: MikroORM;
let sqs: SQSClient;
let queueUrl = "";

beforeAll(async () => {
  const admin = await initOrm(adminUrl);
  await admin.em.getConnection().execute("create database wagering_outbox").catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("already exists")) {
      throw error;
    }
  });
  await admin.close(true);

  orm = await initOrm(databaseUrl);
  await orm.migrator.up();
  await orm.em.getConnection().execute("truncate table outbox_messages, inbox_messages");
  sqs = new SQSClient({
    region: "us-east-1",
    endpoint,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  const created = await sqs.send(new CreateQueueCommand({
    QueueName: "integration-events.fifo",
    Attributes: { FifoQueue: "true", ContentBasedDeduplication: "false" },
  }));
  if (!created.QueueUrl) {
    throw new Error("missing integration events queue");
  }
  queueUrl = created.QueueUrl;
}, 40_000);

afterAll(async () => {
  sqs.destroy();
  await orm.close(true);
});

describe("outbox publisher", () => {
  test("does not publish a row that is still uncommitted", async () => {
    const em = orm.em.fork();
    const seen: string[] = [];
    const publisher = new OutboxPublisher(new SqlOutboxStore(orm), {
      publish(event: LeasedOutboxEvent): Promise<void> {
        seen.push(event.id);
        return Promise.resolve();
      },
    });
    await em.begin();
    try {
      em.persist(pendingRecord());
      await em.flush();
      expect(await publisher.publishDue(now)).toBe(0);
      expect(seen).toEqual([]);
    } finally {
      await em.rollback();
    }
  }, 20_000);

  test("two publishers claim each committed event once", async () => {
    const sink = new SqsIntegrationEventSink(sqs, queueUrl);
    const first = new OutboxPublisher(new SqlOutboxStore(orm), sink);
    const second = new OutboxPublisher(new SqlOutboxStore(orm), sink);
    const pending = await Promise.all([insertPending(), insertPending(), insertPending(), insertPending()]);

    const published = await Promise.all([first.publishDue(now), second.publishDue(now)]);
    expect(published.reduce((sum, count) => sum + count, 0)).toBe(4);

    const bodies = await take(4);
    const ids = bodies.map(eventIdOf);
    expect(new Set(ids).size).toBe(4);
    expect(ids.sort()).toEqual(pending.map((row) => row.id).sort());
    for (const body of bodies) {
      const parsed = JSON.parse(body) as { data: { money: { amount: unknown } } };
      expect(typeof parsed.data.money.amount).toBe("string");
    }

    for (const row of pending) {
      const stored = await orm.em.fork().findOne(OutboxRecord, { id: row.id });
      expect(stored?.publishedAt).toBeTruthy();
    }
    expect(await first.publishDue(new Date(now.getTime() + 120_000))).toBe(0);
  }, 30_000);

  test("a dead publisher leaves the committed event for the next instance", async () => {
    const row = await insertPending();
    const dead = new OutboxPublisher(new SqlOutboxStore(orm), {
      publish(): Promise<void> {
        throw new Error("died before publish");
      },
    });
    expect(await dead.publishDue(now)).toBe(0);

    const leased = await orm.em.fork().findOne(OutboxRecord, { id: row.id });
    expect(leased?.publishedAt ?? null).toBeNull();
    expect(leased?.attempts).toBe(1);
    expect(leased?.nextAttemptAt?.toISOString()).toBe("2026-10-30T15:00:01.000Z");

    const restarted = new OutboxPublisher(new SqlOutboxStore(orm), new SqsIntegrationEventSink(sqs, queueUrl));
    expect(await restarted.publishDue(now)).toBe(0);
    expect(await restarted.publishDue(new Date("2026-10-30T15:00:01.000Z"))).toBe(1);

    const bodies = await take(1);
    expect(bodies.map(eventIdOf)).toEqual([row.id]);
    const stored = await orm.em.fork().findOne(OutboxRecord, { id: row.id });
    expect(stored?.publishedAt).toBeTruthy();
    expect(await restarted.publishDue(new Date("2026-10-30T15:02:00.000Z"))).toBe(0);
    expect(await take(0)).toEqual([]);
  }, 30_000);

  test("a duplicate publish stays safe for the consumer", async () => {
    const row = await insertPending();
    const sink = new SqsIntegrationEventSink(sqs, queueUrl);
    const diedAfterSend = new OutboxPublisher(new SqlOutboxStore(orm), {
      async publish(event: LeasedOutboxEvent): Promise<void> {
        await sink.publish(event);
        throw new Error("died before ack");
      },
    });
    expect(await diedAfterSend.publishDue(now)).toBe(0);
    expect((await orm.em.fork().findOne(OutboxRecord, { id: row.id }))?.publishedAt ?? null).toBeNull();

    const restarted = new OutboxPublisher(new SqlOutboxStore(orm), sink);
    expect(await restarted.publishDue(new Date("2026-10-30T15:00:01.000Z"))).toBe(1);

    const bodies = await take(2);
    expect(bodies.map(eventIdOf)).toEqual([row.id, row.id]);

    const inbox = new SqlIntegrationEventInbox(orm);
    const at = new Date("2026-10-30T15:00:02.000Z");
    expect(await inbox.accept(bodies[0] ?? "", at)).toEqual({ duplicate: false });
    expect(await inbox.accept(bodies[1] ?? "", at)).toEqual({ duplicate: true });
    const stored = await orm.em.fork().find(InboxRecord, {
      consumerName: INTEGRATION_EVENT_CONSUMER,
      messageId: row.id,
    });
    expect(stored).toHaveLength(1);
  }, 30_000);
});

function pendingRecord(): OutboxRecord {
  const id = randomUUID();
  const record = new OutboxRecord();
  record.id = id;
  record.aggregateId = randomUUID();
  record.eventType = "WagerTransactionProcessed";
  record.payload = envelope(id, record.aggregateId);
  record.occurredAt = now;
  record.attempts = 0;
  record.nextAttemptAt = null;
  record.publishedAt = null;
  return record;
}

async function insertPending(): Promise<{ id: string }> {
  const em = orm.em.fork();
  const record = pendingRecord();
  em.persist(record);
  await em.flush();
  return { id: record.id };
}

function envelope(id: string, aggregateId: string): Record<string, unknown> {
  return {
    eventId: id,
    eventType: "WagerTransactionProcessed",
    aggregateId,
    correlationId: id,
    occurredAt: now.toISOString(),
    version: 1,
    data: { money: { amount: "10.00", currency: "BRL" } },
  };
}

function eventIdOf(body: string): string {
  const parsed = JSON.parse(body) as { eventId?: string };
  if (!parsed.eventId) {
    throw new Error("missing event id");
  }
  return parsed.eventId;
}

async function take(expected: number): Promise<string[]> {
  const bodies: string[] = [];
  const deadline = Date.now() + (expected === 0 ? 1_500 : 10_000);
  while (Date.now() < deadline && bodies.length < Math.max(expected, 1)) {
    const response = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 1,
      VisibilityTimeout: 30,
    }));
    const messages = response.Messages ?? [];
    if (messages.length === 0) {
      if (expected === 0 || bodies.length >= expected) {
        break;
      }
      continue;
    }

    for (const message of messages) {
      if (message.Body) {
        bodies.push(message.Body);
      }
      if (message.ReceiptHandle) {
        await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
      }
    }
    if (expected === 0) {
      break;
    }
  }

  return bodies;
}
