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
const databaseUrl = "postgres://wagering:wagering@localhost:5432/wagering_external";

let app: NestExpressApplication;
let orm: MikroORM;
let baseUrl = "";

@Module({
  imports: [DatabaseModule.forRoot(databaseUrl), WalletsModule, WageringModule],
})
class ExternalLookupHttpModule {}

beforeAll(async () => {
  Logger.overrideLogger(false);
  const admin = await initOrm(adminUrl);
  await admin.em.getConnection().execute("create database wagering_external").catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("already exists")) {
      throw error;
    }
  });
  await admin.close(true);

  orm = await initOrm(databaseUrl);
  await orm.migrator.up();
  app = await NestFactory.create(ExternalLookupHttpModule, { logger: false });
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

describe("GET /providers/:providerId/wagering/transactions/:externalTransactionId", () => {
  test("resolves each provider on its own row and keeps that balance", async () => {
    const playerId = randomUUID();
    const opened = await postJson("/wallets", {
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });
    const walletId = opened.body.id as string;
    const externalTransactionId = randomUUID();
    const first = await postWager("provider-a", externalTransactionId, playerId, walletId, "10.00");
    const second = await postWager("provider-b", externalTransactionId, playerId, walletId, "5.00");

    const fromA = await getExternal("provider-a", externalTransactionId);
    expect(fromA.status).toBe(200);
    expect(fromA.body).toMatchObject({
      transactionId: first.transactionId,
      providerId: "provider-a",
      externalTransactionId,
      kind: "BET",
      money: { amount: "10.00", currency: "BRL" },
      status: "PROCESSED",
      balance: { amount: "90.00", currency: "BRL" },
    });
    expect(typeof (fromA.body as { money: { amount: string } }).money.amount).toBe("string");

    const fromB = await getExternal("provider-b", externalTransactionId);
    expect(fromB.body).toMatchObject({
      transactionId: second.transactionId,
      providerId: "provider-b",
      money: { amount: "5.00", currency: "BRL" },
      balance: { amount: "85.00", currency: "BRL" },
    });

    const missing = await getExternal("provider-a", randomUUID());
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "transaction_not_found" });

    const blank = await getExternal(" ", externalTransactionId);
    expect(blank.status).toBe(400);
    expect(blank.body).toEqual({ error: "invalid_payload" });
  }, 20_000);
});

async function postJson(path: string, body: unknown): Promise<{ body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { body: await response.json() as Record<string, unknown> };
}

async function postWager(
  providerId: string,
  externalTransactionId: string,
  playerId: string,
  walletId: string,
  amount: string,
): Promise<{ transactionId: string }> {
  const response = await fetch(`${baseUrl}/wagering/transactions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `${providerId}:${externalTransactionId}`,
    },
    body: JSON.stringify({
      providerId,
      externalTransactionId,
      playerId,
      walletId,
      roundId: "round-external",
      gameId: "fortune-chimp",
      kind: "BET",
      money: { amount, currency: "BRL" },
    }),
  });
  if (response.status !== 201) {
    throw new Error(`bet failed with ${response.status}`);
  }
  return await response.json() as { transactionId: string };
}

async function getExternal(providerId: string, externalTransactionId: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(
    `${baseUrl}/providers/${encodeURIComponent(providerId)}/wagering/transactions/${encodeURIComponent(externalTransactionId)}`,
  );
  return { status: response.status, body: await response.json() };
}
