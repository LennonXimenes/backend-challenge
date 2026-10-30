import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { CreateQueueCommand, DeleteMessageCommand, GetQueueAttributesCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Logger, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { MikroORM } from "@mikro-orm/postgresql";
import { SubmitWager, type ConsumeResult } from "../../src/application/wagering/submit-wager";
import { WagerRepository } from "../../src/application/wagering/wager-repository";
import { DatabaseModule } from "../../src/infra/database/database.module";
import { initOrm } from "../../src/infra/database/orm-config";
import { WalletExceptionFilter } from "../../src/infra/http/wallet-exception.filter";
import { SqsWagerConsumer } from "../../src/infra/sqs/sqs-consumer";
import { WageringModule } from "../../src/wagering.module";
import { WalletsModule } from "../../src/wallets.module";

const adminUrl = "postgres://wagering:wagering@localhost:5432/postgres";
const databaseUrl = "postgres://wagering:wagering@localhost:5432/wagering_sqs";
const endpoint = "http://localhost:4566";
const queueName = "wager-transactions.fifo";
const dlqName = "wager-transactions-dlq.fifo";

let app: NestExpressApplication;
let orm: MikroORM;
let sqs: SQSClient;
let queueUrl = "";
let dlqUrl = "";
let baseUrl = "";

@Module({
  imports: [DatabaseModule.forRoot(databaseUrl), WalletsModule, WageringModule],
})
class SqsHttpModule {}

beforeAll(async () => {
  Logger.overrideLogger(false);
  const admin = await initOrm(adminUrl);
  await admin.em.getConnection().execute("create database wagering_sqs").catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("already exists")) {
      throw error;
    }
  });
  await admin.close(true);

  orm = await initOrm(databaseUrl);
  await orm.migrator.up();
  app = await NestFactory.create(SqsHttpModule, { logger: false });
  app.useGlobalFilters(new WalletExceptionFilter());
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;

  sqs = new SQSClient({
    region: "us-east-1",
    endpoint,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  queueUrl = await ensureQueue(queueName);
  dlqUrl = await ensureQueue(dlqName);
}, 40_000);

beforeEach(async () => {
  await drain(queueUrl);
  await drain(dlqUrl);
});

afterAll(async () => {
  sqs.destroy();
  await app.close();
  await orm.close(true);
});

describe("sqs consumer", () => {
  test("debits once when the same message is delivered twice and acks only after commit", async () => {
    const playerId = randomUUID();
    const walletId = await openWallet(playerId, "100.00");
    const messageId = randomUUID();
    const body = envelope(messageId, {
      providerId: "provider-a",
      externalTransactionId: randomUUID(),
      idempotencyKey: `provider-a:${randomUUID()}`,
      playerId,
      walletId,
      roundId: "round-sqs",
      gameId: "fortune-chimp",
      kind: "BET",
      money: { amount: "40.00", currency: "BRL" },
    });
    await send(queueUrl, walletId, body);
    const consumer = new SqsWagerConsumer(sqs, app.get(SubmitWager), queueUrl, dlqUrl);
    const running = consumer.run();
    await waitFor(async () => (await wallet(walletId)).balance.amount === "60.00");
    await send(queueUrl, walletId, body);
    await waitFor(async () => await inboxCount(messageId) === 1 && await debits(walletId) === 1 && await queueDepth(queueUrl) === 0);
    expect(await wallet(walletId)).toMatchObject({ version: 2, balance: { amount: "60.00" } });
    expect(await reconstructed(walletId)).toBe("60.00");
    await consumer.stop();
    await running;
  }, 30_000);

  test("acks a business rejection and parks an invalid payload on the dlq", async () => {
    const playerId = randomUUID();
    const walletId = await openWallet(playerId, "10.00");
    const externalTransactionId = randomUUID();
    await send(queueUrl, walletId, envelope(randomUUID(), {
      providerId: "provider-a",
      externalTransactionId,
      idempotencyKey: `provider-a:${externalTransactionId}`,
      playerId,
      walletId,
      roundId: "round-sqs",
      gameId: "fortune-chimp",
      kind: "BET",
      money: { amount: "80.00", currency: "BRL" },
    }));
    await send(queueUrl, "invalid", "not-json");
    const consumer = new SqsWagerConsumer(sqs, app.get(SubmitWager), queueUrl, dlqUrl);
    const running = consumer.run();
    await waitFor(async () => await queueDepth(dlqUrl) === 1 && await queueDepth(queueUrl) === 0);
    const rejected = await orm.em.getConnection().execute<Array<{ status: string; failure_code: string }>>(
      `select status, failure_code from wager_transactions where external_transaction_id = ?`,
      [externalTransactionId],
    );
    expect(rejected[0]).toEqual({ status: "REJECTED", failure_code: "INSUFFICIENT_BALANCE" });
    expect((await wallet(walletId)).balance.amount).toBe("10.00");
    await consumer.stop();
    await running;
  }, 30_000);

  test("SIGTERM returns visibility when the message cannot finish in time", async () => {
    const holder = new HoldingSubmit();
    const consumer = new SqsWagerConsumer(sqs, holder, queueUrl, dlqUrl, 30);
    const running = consumer.run();
    await send(queueUrl, "shutdown", envelope(randomUUID(), {
      providerId: "provider-a",
      externalTransactionId: randomUUID(),
      idempotencyKey: `provider-a:${randomUUID()}`,
      playerId: randomUUID(),
      walletId: randomUUID(),
      roundId: "round-sqs",
      gameId: "fortune-chimp",
      kind: "BET",
      money: { amount: "1.00", currency: "BRL" },
    }));
    await holder.entered;
    await consumer.stop();
    const returned = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 2,
    }));
    expect(returned.Messages?.length).toBe(1);
    holder.release();
    await running;
    const handle = returned.Messages?.[0]?.ReceiptHandle;
    if (handle) {
      await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: handle }));
    }
  }, 20_000);
});

class HoldingSubmit extends SubmitWager {
  entered: Promise<void>;
  private resolveEntered: () => void = () => undefined;
  release: () => void = () => undefined;

  constructor() {
    super({
      submit: () => Promise.reject(new Error("unused")),
      consume: () => Promise.reject(new Error("unused")),
      resumeNext: () => Promise.resolve(false),
    } as unknown as WagerRepository);
    this.entered = new Promise((resolve) => {
      this.resolveEntered = resolve;
    });
  }

  override executeFromInbox(): Promise<ConsumeResult> {
    this.resolveEntered();
    return new Promise((resolve) => {
      this.release = () => resolve({ duplicate: false });
    });
  }
}

async function drain(url: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: url,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 0,
      VisibilityTimeout: 1,
    }));
    for (const message of response.Messages ?? []) {
      if (message.ReceiptHandle) {
        await sqs.send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: message.ReceiptHandle }));
      }
    }
    if (await queueDepth(url) === 0) {
      return;
    }
  }
}

async function ensureQueue(name: string): Promise<string> {
  const created = await sqs.send(new CreateQueueCommand({
    QueueName: name,
    Attributes: { FifoQueue: "true", ContentBasedDeduplication: "false" },
  }));
  if (!created.QueueUrl) {
    throw new Error(`missing queue url for ${name}`);
  }
  return created.QueueUrl;
}

function envelope(messageId: string, data: Record<string, unknown>): string {
  return JSON.stringify({
    messageId,
    type: "WagerTransactionRequested",
    occurredAt: "2026-10-30T14:00:00.000Z",
    data,
  });
}

async function send(url: string, groupId: string, body: string): Promise<void> {
  await sqs.send(new SendMessageCommand({
    QueueUrl: url,
    MessageBody: body,
    MessageGroupId: groupId,
    MessageDeduplicationId: randomUUID(),
  }));
}

async function openWallet(playerId: string, amount: string): Promise<string> {
  const response = await fetch(`${baseUrl}/wallets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId, initialBalance: { amount, currency: "BRL" } }),
  });
  const body = (await response.json()) as { id: string };
  expect(response.status).toBe(201);
  return body.id;
}

async function wallet(walletId: string): Promise<{ version: number; balance: { amount: string } }> {
  return (await fetch(`${baseUrl}/wallets/${walletId}`)).json() as Promise<{ version: number; balance: { amount: string } }>;
}

async function inboxCount(messageId: string): Promise<number> {
  const rows = await orm.em.getConnection().execute<Array<{ count: string }>>(
    `select count(*)::text as count from inbox_messages where message_id = ?`,
    [messageId],
  );
  return Number(rows[0]?.count ?? "0");
}

async function debits(walletId: string): Promise<number> {
  const rows = await orm.em.getConnection().execute<Array<{ count: string }>>(
    `select count(*) filter (where direction = 'DEBIT')::text as count
     from wallet_ledger_entries where wallet_id = ?::uuid`,
    [walletId],
  );
  return Number(rows[0]?.count ?? "0");
}

async function reconstructed(walletId: string): Promise<string | undefined> {
  const rows = await orm.em.getConnection().execute<Array<{ balance: string; reconstructed: string }>>(
    `select w.balance::text as balance,
            coalesce(sum(case when l.direction = 'CREDIT' then l.amount else -l.amount end), 0)::text as reconstructed
     from wallets w
     join wallet_ledger_entries l on l.wallet_id = w.id
     where w.id = ?::uuid
     group by w.balance`,
    [walletId],
  );
  expect(rows[0]?.balance).toBe(rows[0]?.reconstructed);
  return rows[0]?.reconstructed;
}

async function queueDepth(url: string): Promise<number> {
  const response = await sqs.send(new GetQueueAttributesCommand({
    QueueUrl: url,
    AttributeNames: ["ApproximateNumberOfMessages"],
  }));
  return Number(response.Attributes?.ApproximateNumberOfMessages ?? "0");
}

async function waitFor(ready: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await ready()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("timed out waiting for sqs");
}
