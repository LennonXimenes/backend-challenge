import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { LockMode } from "@mikro-orm/core";
import { Logger, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { MikroORM } from "@mikro-orm/postgresql";
import { DatabaseModule } from "../../src/infra/database/database.module";
import { initOrm } from "../../src/infra/database/orm-config";
import { WalletRecord } from "../../src/infra/database/wallet.record";
import { WalletExceptionFilter } from "../../src/infra/http/wallet-exception.filter";
import { WageringModule } from "../../src/wagering.module";
import { WalletsModule } from "../../src/wallets.module";

const adminUrl = "postgres://wagering:wagering@localhost:5432/postgres";
const databaseUrl = "postgres://wagering:wagering@localhost:5432/wagering_race";

let app: NestExpressApplication;
let orm: MikroORM;
let baseUrl = "";

@Module({
  imports: [DatabaseModule.forRoot(databaseUrl), WalletsModule, WageringModule],
})
class RaceHttpModule {}

beforeAll(async () => {
  Logger.overrideLogger(false);
  const admin = await initOrm(adminUrl);
  await admin.em.getConnection().execute("create database wagering_race").catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("already exists")) {
      throw error;
    }
  });
  await admin.close(true);

  orm = await initOrm(databaseUrl);
  await orm.migrator.up();
  app = await NestFactory.create(RaceHttpModule, { logger: false });
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

describe("concurrent wagers", () => {
  test("two bets of 80 on a balance of 100 leave a single debit, and a retry does not repeat it", async () => {
    const playerId = randomUUID();
    const walletId = await openWallet(playerId, "100.00");
    const [first, second] = await Promise.all([
      postWager(bet(playerId, walletId, "80.00")),
      postWager(bet(playerId, walletId, "80.00")),
    ]);

    const processed = [first, second].filter((result) => result.body.status === "PROCESSED");
    const rejected = [first, second].filter((result) => result.body.status === "REJECTED");
    expect(processed).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(processed[0]?.status).toBe(201);
    expect(rejected[0]?.status).toBe(422);
    expect(processed[0]?.body).toMatchObject({
      balance: { amount: "20.00", currency: "BRL" },
      idempotentReplay: false,
    });
    expect(rejected[0]?.body).toMatchObject({
      failureCode: "INSUFFICIENT_BALANCE",
      balance: { amount: "20.00", currency: "BRL" },
      idempotentReplay: false,
    });

    const replayedProcessed = await postWager(processed[0]!.request);
    const replayedRejected = await postWager(rejected[0]!.request);
    expect(replayedProcessed.status).toBe(201);
    expect(replayedProcessed.body).toMatchObject({
      transactionId: processed[0]?.body.transactionId,
      balance: { amount: "20.00", currency: "BRL" },
      idempotentReplay: true,
    });
    expect(replayedRejected.status).toBe(422);
    expect(replayedRejected.body).toMatchObject({
      transactionId: rejected[0]?.body.transactionId,
      failureCode: "INSUFFICIENT_BALANCE",
      balance: { amount: "20.00", currency: "BRL" },
      idempotentReplay: true,
    });

    expect(await walletSnapshot(walletId)).toEqual({
      balance: "20.00",
      version: "2",
      reconstructed: "20.00",
      debits: "1",
    });
  }, 20_000);

  test("the same bet sent 50 times in parallel debits once", async () => {
    const playerId = randomUUID();
    const walletId = await openWallet(playerId, "100.00");
    const body = bet(playerId, walletId, "10.00");
    const results = await Promise.all(Array.from({ length: 50 }, () => postWager(body)));

    expect(results.every((result) => result.status === 201)).toBe(true);
    expect(results.filter((result) => result.body.idempotentReplay === false)).toHaveLength(1);
    expect(results.every((result) => result.body.transactionId === results[0]?.body.transactionId)).toBe(true);
    expect(results[0]?.body.balance).toEqual({ amount: "90.00", currency: "BRL" });
    expect(await walletSnapshot(walletId)).toEqual({
      balance: "90.00",
      version: "2",
      reconstructed: "90.00",
      debits: "1",
    });
  }, 20_000);

  test("two wallets move in parallel, and a lock on one does not block the other", async () => {
    const leftPlayer = randomUUID();
    const rightPlayer = randomUUID();
    const [leftId, rightId] = await Promise.all([
      openWallet(leftPlayer, "50.00"),
      openWallet(rightPlayer, "50.00"),
    ]);
    const [left, right] = await Promise.all([
      postWager(bet(leftPlayer, leftId, "10.00")),
      postWager(bet(rightPlayer, rightId, "10.00")),
    ]);
    expect(left.status).toBe(201);
    expect(right.status).toBe(201);
    expect(left.body.balance).toEqual({ amount: "40.00", currency: "BRL" });
    expect(right.body.balance).toEqual({ amount: "40.00", currency: "BRL" });

    const freePlayer = randomUUID();
    const heldId = await openWallet(randomUUID(), "30.00");
    const freeId = await openWallet(freePlayer, "30.00");
    await orm.em.fork().transactional(async (em) => {
      const locked = await em.findOne(WalletRecord, { id: heldId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      expect(locked).not.toBeNull();
      const moved = await postWager(bet(freePlayer, freeId, "5.00"), 3_000);
      expect(moved.status).toBe(201);
      expect(moved.body.balance).toEqual({ amount: "25.00", currency: "BRL" });
    });
  }, 20_000);
});

function bet(playerId: string, walletId: string, amount: string): Record<string, unknown> {
  return {
    providerId: "provider-a",
    externalTransactionId: randomUUID(),
    playerId,
    walletId,
    roundId: "round-race",
    gameId: "fortune-chimp",
    kind: "BET",
    money: { amount, currency: "BRL" },
  };
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

async function postWager(body: Record<string, unknown>, timeoutMs = 10_000): Promise<{
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
    signal: AbortSignal.timeout(timeoutMs),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
    request: body,
  };
}

async function walletSnapshot(walletId: string): Promise<{ balance: string; version: string; reconstructed: string; debits: string }> {
  const rows = await orm.em.getConnection().execute<Array<{ balance: string; version: string; reconstructed: string; debits: string }>>(
    `select w.balance::text as balance,
            w.version::text as version,
            coalesce(sum(case when l.direction = 'CREDIT' then l.amount else -l.amount end), 0)::text as reconstructed,
            count(*) filter (where l.direction = 'DEBIT')::text as debits
     from wallets w
     join wallet_ledger_entries l on l.wallet_id = w.id
     where w.id = ?::uuid
     group by w.balance, w.version`,
    [walletId],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("wallet snapshot missing");
  }
  return row;
}
