import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Logger, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { MikroORM } from "@mikro-orm/postgresql";
import { PendingReferenceWorker } from "../../src/application/wagering/pending-reference-worker";
import { DatabaseModule } from "../../src/infra/database/database.module";
import { initOrm } from "../../src/infra/database/orm-config";
import { WalletExceptionFilter } from "../../src/infra/http/wallet-exception.filter";
import { WageringModule } from "../../src/wagering.module";
import { WalletsModule } from "../../src/wallets.module";

const adminUrl = "postgres://wagering:wagering@localhost:5432/postgres";
const databaseUrl = "postgres://wagering:wagering@localhost:5432/wagering_pending";

let app: NestExpressApplication;
let orm: MikroORM;
let worker: PendingReferenceWorker;
let baseUrl = "";

@Module({
  imports: [DatabaseModule.forRoot(databaseUrl), WalletsModule, WageringModule],
})
class PendingHttpModule {}

beforeAll(async () => {
  Logger.overrideLogger(false);
  const admin = await initOrm(adminUrl);
  await admin.em.getConnection().execute("create database wagering_pending").catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("already exists")) {
      throw error;
    }
  });
  await admin.close(true);

  orm = await initOrm(databaseUrl);
  await orm.migrator.up();
  app = await NestFactory.create(PendingHttpModule, { logger: false });
  app.useGlobalFilters(new WalletExceptionFilter());
  worker = app.get(PendingReferenceWorker);
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app.close();
  await orm.close(true);
});

describe("pending reference worker", () => {
  test("waits for the backoff, then credits the refund once the bet exists", async () => {
    const playerId = randomUUID();
    const walletId = await openWallet(playerId, "100.00");
    const betExternalId = randomUUID();
    const refund = await postWager({
      providerId: "provider-a",
      externalTransactionId: randomUUID(),
      playerId,
      walletId,
      roundId: "round-pending",
      gameId: "fortune-chimp",
      kind: "REFUND",
      money: { amount: "40.00", currency: "BRL" },
      referenceExternalTransactionId: betExternalId,
    });
    expect(refund.status).toBe(202);

    const parked = await pendingRow(refund.body.transactionId as string);
    expect(parked.status).toBe("PENDING_REFERENCE");
    expect(parked.attempts).toBe(1);
    await worker.run(new Date());
    expect((await pendingRow(refund.body.transactionId as string)).attempts).toBe(1);

    const bet = await postWager({
      providerId: "provider-a",
      externalTransactionId: betExternalId,
      playerId,
      walletId,
      roundId: "round-pending",
      gameId: "fortune-chimp",
      kind: "BET",
      money: { amount: "40.00", currency: "BRL" },
    });
    expect(bet.status).toBe(201);

    const due = await pendingRow(refund.body.transactionId as string);
    expect(await worker.run(dueAt(due.next_attempt_at))).toBe(true);

    const resolved = await pendingRow(refund.body.transactionId as string);
    expect(resolved.status).toBe("PROCESSED");
    expect(await worker.run(new Date(due.next_attempt_at))).toBe(false);

    const replay = await postWager(refund.request);
    expect(replay.status).toBe(201);
    expect(replay.body).toMatchObject({
      transactionId: refund.body.transactionId,
      balance: { amount: "100.00", currency: "BRL" },
      idempotentReplay: true,
    });
    expect(await eventTypes(refund.body.transactionId as string)).toEqual([
      "WagerTransactionPendingReference",
      "WagerTransactionProcessed",
      "WalletBalanceChanged",
    ]);
    expect(await reconstructed(walletId)).toBe("100.00");
  });

  test("rejects the refund after five due attempts when the bet never arrives", async () => {
    const playerId = randomUUID();
    const walletId = await openWallet(playerId, "80.00");
    const refund = await postWager({
      providerId: "provider-a",
      externalTransactionId: randomUUID(),
      playerId,
      walletId,
      roundId: "round-pending",
      gameId: "fortune-chimp",
      kind: "REFUND",
      money: { amount: "15.00", currency: "BRL" },
      referenceExternalTransactionId: randomUUID(),
    });
    expect(refund.status).toBe(202);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const row = await pendingRow(refund.body.transactionId as string);
      expect(row.status).toBe("PENDING_REFERENCE");
      expect(await worker.run(dueAt(row.next_attempt_at))).toBe(true);
    }

    const rejected = await pendingRow(refund.body.transactionId as string);
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.failure_code).toBe("REFERENCE_NOT_FOUND");
    expect(await eventTypes(refund.body.transactionId as string)).toEqual([
      "WagerTransactionPendingReference",
      "WagerTransactionRejected",
    ]);

    const wallet = await (await fetch(`${baseUrl}/wallets/${walletId}`)).json() as { version: number; balance: { amount: string } };
    expect(wallet).toMatchObject({ version: 1, balance: { amount: "80.00" } });
    expect(await reconstructed(walletId)).toBe("80.00");
  });
});

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

async function postWager(body: Record<string, unknown>): Promise<{
  status: number;
  body: Record<string, unknown>;
  request: Record<string, unknown>;
}> {
  const response = await fetch(`${baseUrl}/wagering/transactions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `${body.providerId as string}:${body.externalTransactionId as string}`,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
    request: body,
  };
}

function dueAt(value: Date | string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("invalid reference_next_attempt_at");
  }
  return date;
}

async function pendingRow(transactionId: string): Promise<{ status: string; failure_code: string | null; next_attempt_at: Date | string; attempts: number }> {
  const rows = await orm.em.getConnection().execute<Array<{ status: string; failure_code: string | null; next_attempt_at: Date | string; attempts: number }>>(
    `select status, failure_code, reference_next_attempt_at as next_attempt_at, reference_attempts as attempts
     from wager_transactions
     where id = ?::uuid`,
    [transactionId],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("pending row missing");
  }
  return row;
}

async function eventTypes(transactionId: string): Promise<string[]> {
  const rows = await orm.em.getConnection().execute<Array<{ event_type: string }>>(
    `select event_type
     from outbox_messages
     where payload #>> '{data,transactionId}' = ?
     order by event_type`,
    [transactionId],
  );
  return rows.map((row) => row.event_type);
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
