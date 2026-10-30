import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Logger, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { MikroORM } from "@mikro-orm/postgresql";
import { DatabaseModule } from "../../src/infra/database/database.module";
import { initOrm } from "../../src/infra/database/orm-config";
import { WalletExceptionFilter } from "../../src/infra/http/wallet-exception.filter";
import { WageringModule } from "../../src/wagering.module";
import { WalletsModule } from "../../src/wallets.module";

const adminUrl = "postgres://wagering:wagering@localhost:5432/postgres";
const databaseUrl = "postgres://wagering:wagering@localhost:5432/wagering_bets";

let app: NestExpressApplication;
let orm: MikroORM;
let baseUrl = "";

@Module({
  imports: [DatabaseModule.forRoot(databaseUrl), WalletsModule, WageringModule],
})
class WagerHttpModule {}

beforeAll(async () => {
  Logger.overrideLogger(false);
  const admin = await initOrm(adminUrl);
  await admin.em.getConnection().execute("create database wagering_bets").catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("already exists")) {
      throw error;
    }
  });
  await admin.close(true);

  orm = await initOrm(databaseUrl);
  await orm.migrator.up();
  app = await NestFactory.create(WagerHttpModule, { logger: false });
  app.useGlobalFilters(new WalletExceptionFilter());
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app.close();
  await orm.close(true);
});

describe("POST /wagering/transactions", () => {
  test("debits a bet, rejects an insufficient bet, and credits a win", async () => {
    const playerId = randomUUID();
    const opened = await postJson("/wallets", {
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });
    const walletId = opened.body.id as string;

    const bet = await postWager({
      providerId: "provider-a",
      externalTransactionId: randomUUID(),
      playerId,
      walletId,
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: "BET",
      money: { amount: "25.00", currency: "BRL" },
    });
    expect(bet.status).toBe(201);
    expect(bet.body).toMatchObject({
      status: "PROCESSED",
      balance: { amount: "75.00", currency: "BRL" },
      idempotentReplay: false,
    });

    const walletAfterBet = await (await fetch(`${baseUrl}/wallets/${walletId}`)).json() as { version: number };
    expect(walletAfterBet.version).toBe(2);

    const tooMuch = await postWager({
      providerId: "provider-a",
      externalTransactionId: randomUUID(),
      playerId,
      walletId,
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: "BET",
      money: { amount: "80.00", currency: "BRL" },
    });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body).toMatchObject({
      status: "REJECTED",
      failureCode: "INSUFFICIENT_BALANCE",
      balance: { amount: "75.00", currency: "BRL" },
    });

    const still = await (await fetch(`${baseUrl}/wallets/${walletId}`)).json() as { version: number; balance: { amount: string } };
    expect(still.version).toBe(2);
    expect(still.balance.amount).toBe("75.00");

    const win = await postWager({
      providerId: "provider-a",
      externalTransactionId: randomUUID(),
      playerId,
      walletId,
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: "WIN",
      money: { amount: "10.00", currency: "BRL" },
      referenceExternalTransactionId: bet.request.externalTransactionId,
    });
    expect(win.status).toBe(201);
    expect(win.body).toMatchObject({
      status: "PROCESSED",
      balance: { amount: "85.00", currency: "BRL" },
    });

    const rows = await orm.em.getConnection().execute<Array<{ balance: string; reconstructed: string; debits: string; credits: string }>>(
      `select w.balance::text as balance,
              coalesce(sum(case when l.direction = 'CREDIT' then l.amount else -l.amount end), 0)::text as reconstructed,
              count(*) filter (where l.direction = 'DEBIT')::text as debits,
              count(*) filter (where l.direction = 'CREDIT')::text as credits
       from wallets w
       join wallet_ledger_entries l on l.wallet_id = w.id
       where w.id = ?::uuid
       group by w.balance`,
      [walletId],
    );
    expect(rows[0]).toEqual({ balance: "85.00", reconstructed: "85.00", debits: "1", credits: "2" });
  });

  test("a missing win reference stays pending and does not move the balance", async () => {
    const playerId = randomUUID();
    const opened = await postJson("/wallets", {
      playerId,
      initialBalance: { amount: "40.00", currency: "BRL" },
    });
    const walletId = opened.body.id as string;
    const pending = await postWager({
      providerId: "provider-a",
      externalTransactionId: randomUUID(),
      playerId,
      walletId,
      roundId: "round-2",
      gameId: "fortune-chimp",
      kind: "WIN",
      money: { amount: "5.00", currency: "BRL" },
      referenceExternalTransactionId: "bet-not-here",
    });

    expect(pending.status).toBe(202);
    expect(pending.body).toMatchObject({
      status: "PENDING_REFERENCE",
      balance: { amount: "40.00", currency: "BRL" },
    });

    const ledger = await orm.em.getConnection().execute<Array<{ count: string }>>(
      `select count(*)::text as count from wallet_ledger_entries where wallet_id = ?::uuid`,
      [walletId],
    );
    expect(ledger[0]?.count).toBe("1");
  });

  test("replays the original balance and rejects a different payload for the same key", async () => {
    const playerId = randomUUID();
    const opened = await postJson("/wallets", {
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });
    const walletId = opened.body.id as string;
    const bet = await postWager({
      providerId: "provider-a",
      externalTransactionId: randomUUID(),
      playerId,
      walletId,
      roundId: "round-replay",
      gameId: "fortune-chimp",
      kind: "BET",
      money: { amount: "25.00", currency: "BRL" },
    });
    expect(bet.status).toBe(201);

    const replay = await postWager(bet.request);
    expect(replay.status).toBe(201);
    expect(replay.body).toMatchObject({
      transactionId: bet.body.transactionId,
      status: "PROCESSED",
      balance: { amount: "75.00", currency: "BRL" },
      idempotentReplay: true,
    });

    const rejected = await postWager({
      providerId: "provider-a",
      externalTransactionId: randomUUID(),
      playerId,
      walletId,
      roundId: "round-replay",
      gameId: "fortune-chimp",
      kind: "BET",
      money: { amount: "80.00", currency: "BRL" },
    });
    expect(rejected.status).toBe(422);
    const rejectedReplay = await postWager(rejected.request);
    expect(rejectedReplay.status).toBe(422);
    expect(rejectedReplay.body).toMatchObject({
      transactionId: rejected.body.transactionId,
      status: "REJECTED",
      failureCode: "INSUFFICIENT_BALANCE",
      balance: { amount: "75.00", currency: "BRL" },
      idempotentReplay: true,
    });

    const later = await postWager({
      providerId: "provider-a",
      externalTransactionId: randomUUID(),
      playerId,
      walletId,
      roundId: "round-replay",
      gameId: "fortune-chimp",
      kind: "BET",
      money: { amount: "10.00", currency: "BRL" },
    });
    expect(later.status).toBe(201);
    expect(later.body).toMatchObject({ balance: { amount: "65.00", currency: "BRL" }, idempotentReplay: false });

    const originalAgain = await postWager(bet.request);
    expect(originalAgain.status).toBe(201);
    expect(originalAgain.body).toMatchObject({
      transactionId: bet.body.transactionId,
      balance: { amount: "75.00", currency: "BRL" },
      idempotentReplay: true,
    });

    const conflict = await postWager({
      ...bet.request,
      money: { amount: "30.00", currency: "BRL" },
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual({ error: "transaction_conflict" });

    const wallet = await (await fetch(`${baseUrl}/wallets/${walletId}`)).json() as { version: number; balance: { amount: string } };
    expect(wallet.balance.amount).toBe("65.00");
    expect(wallet.version).toBe(3);

    const rows = await orm.em.getConnection().execute<Array<{ debits: string; credits: string }>>(
      `select count(*) filter (where direction = 'DEBIT')::text as debits,
              count(*) filter (where direction = 'CREDIT')::text as credits
       from wallet_ledger_entries
       where wallet_id = ?::uuid`,
      [walletId],
    );
    expect(rows[0]).toEqual({ debits: "2", credits: "1" });
  });

  test("writes processed, rejected and pending events in the same transaction and does not repeat them", async () => {
    const playerId = randomUUID();
    const opened = await postJson("/wallets", {
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });
    const walletId = opened.body.id as string;
    const bet = await postWager({
      providerId: "provider-a",
      externalTransactionId: randomUUID(),
      playerId,
      walletId,
      roundId: "round-outbox",
      gameId: "fortune-chimp",
      kind: "BET",
      money: { amount: "25.00", currency: "BRL" },
    });
    expect(bet.status).toBe(201);
    expect(await eventTypes(bet.body.transactionId as string)).toEqual([
      "WagerTransactionProcessed",
      "WalletBalanceChanged",
    ]);
    expect(await moneyType(bet.body.transactionId as string)).toBe("string");

    await postWager(bet.request);
    expect(await eventTypes(bet.body.transactionId as string)).toEqual([
      "WagerTransactionProcessed",
      "WalletBalanceChanged",
    ]);

    const rejected = await postWager({
      providerId: "provider-a",
      externalTransactionId: randomUUID(),
      playerId,
      walletId,
      roundId: "round-outbox",
      gameId: "fortune-chimp",
      kind: "BET",
      money: { amount: "80.00", currency: "BRL" },
    });
    expect(rejected.status).toBe(422);
    expect(await eventTypes(rejected.body.transactionId as string)).toEqual(["WagerTransactionRejected"]);

    const pending = await postWager({
      providerId: "provider-a",
      externalTransactionId: randomUUID(),
      playerId,
      walletId,
      roundId: "round-outbox",
      gameId: "fortune-chimp",
      kind: "WIN",
      money: { amount: "5.00", currency: "BRL" },
      referenceExternalTransactionId: "missing-bet",
    });
    expect(pending.status).toBe(202);
    expect(await eventTypes(pending.body.transactionId as string)).toEqual(["WagerTransactionPendingReference"]);

    const unpublished = await orm.em.getConnection().execute<Array<{ count: string }>>(
      `select count(*)::text as count
       from outbox_messages
       where payload #>> '{data,walletId}' = ?
         and published_at is not null`,
      [walletId],
    );
    expect(unpublished[0]?.count).toBe("0");
  });

  test("a missing idempotency key is a bad request", async () => {
    const response = await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "provider-a",
        externalTransactionId: randomUUID(),
        playerId: randomUUID(),
        walletId: randomUUID(),
        roundId: "round-key",
        gameId: "fortune-chimp",
        kind: "BET",
        money: { amount: "1.00", currency: "BRL" },
      }),
    });
    expect(response.status).toBe(400);
  });
});

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

async function moneyType(transactionId: string): Promise<string | undefined> {
  const rows = await orm.em.getConnection().execute<Array<{ amount_type: string }>>(
    `select jsonb_typeof(payload #> '{data,money,amount}') as amount_type
     from outbox_messages
     where payload #>> '{data,transactionId}' = ?
       and event_type = 'WalletBalanceChanged'`,
    [transactionId],
  );
  return rows[0]?.amount_type;
}

async function postJson(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function postWager(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown>; request: Record<string, unknown> }> {
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
