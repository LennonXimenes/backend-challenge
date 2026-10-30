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
const databaseUrl = "postgres://wagering:wagering@localhost:5432/wagering_lookup";

let app: NestExpressApplication;
let orm: MikroORM;
let baseUrl = "";

@Module({
  imports: [DatabaseModule.forRoot(databaseUrl), WalletsModule, WageringModule],
})
class WagerLookupHttpModule {}

beforeAll(async () => {
  Logger.overrideLogger(false);
  const admin = await initOrm(adminUrl);
  await admin.em.getConnection().execute("create database wagering_lookup").catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("already exists")) {
      throw error;
    }
  });
  await admin.close(true);

  orm = await initOrm(databaseUrl);
  await orm.migrator.up();
  app = await NestFactory.create(WagerLookupHttpModule, { logger: false });
  app.useGlobalFilters(new WalletExceptionFilter());
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
}, 40_000);

afterAll(async () => {
  await app.close();
  await orm.close(true);
});

describe("GET /wagering/transactions/:transactionId", () => {
  test("returns the stored transaction and the balance of that moment", async () => {
    const playerId = randomUUID();
    const opened = await postJson("/wallets", {
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });
    const walletId = opened.body.id as string;
    const first = await postWager(playerId, walletId, "10.00");
    await postWager(playerId, walletId, "20.00");

    const read = await getTransaction(first.transactionId);
    expect(read.status).toBe(200);
    const body = read.body as TransactionBody;
    expect(body).toMatchObject({
      transactionId: first.transactionId,
      providerId: "provider-a",
      playerId,
      walletId,
      kind: "BET",
      money: { amount: "10.00", currency: "BRL" },
      status: "PROCESSED",
      failureCode: null,
      balance: { amount: "90.00", currency: "BRL" },
      referenceExternalTransactionId: null,
    });
    expect(typeof body.money.amount).toBe("string");
    expect(typeof body.balance.amount).toBe("string");
    expect(body.processedAt).toEqual(expect.any(String));

    const rejected = await postWager(playerId, walletId, "80.00");
    expect(rejected.status).toBe("REJECTED");
    const rejectedRead = await getTransaction(rejected.transactionId);
    expect(rejectedRead.body).toMatchObject({
      status: "REJECTED",
      failureCode: "INSUFFICIENT_BALANCE",
      balance: { amount: "70.00", currency: "BRL" },
      money: { amount: "80.00", currency: "BRL" },
    });

    const missing = await getTransaction(randomUUID());
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "transaction_not_found" });
    const invalid = await getTransaction("not-a-uuid");
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ error: "invalid_payload" });
  }, 20_000);
});

interface TransactionBody {
  money: { amount: string };
  balance: { amount: string };
  processedAt: string | null;
}

async function postJson(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function postWager(playerId: string, walletId: string, amount: string): Promise<{ transactionId: string; status: string }> {
  const externalTransactionId = randomUUID();
  const response = await fetch(`${baseUrl}/wagering/transactions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `provider-a:${externalTransactionId}`,
    },
    body: JSON.stringify({
      providerId: "provider-a",
      externalTransactionId,
      playerId,
      walletId,
      roundId: "round-lookup",
      gameId: "fortune-chimp",
      kind: "BET",
      money: { amount, currency: "BRL" },
    }),
  });
  const body = await response.json() as { transactionId: string; status: string };
  if (response.status !== 201 && response.status !== 422) {
    throw new Error(`bet failed with ${response.status}`);
  }
  return body;
}

async function getTransaction(transactionId: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}/wagering/transactions/${transactionId}`);
  return { status: response.status, body: await response.json() };
}
