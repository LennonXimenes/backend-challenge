import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Logger, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { MikroORM } from "@mikro-orm/postgresql";
import { DatabaseModule } from "../../src/infra/database/database.module";
import { initOrm } from "../../src/infra/database/orm-config";
import { WalletExceptionFilter } from "../../src/infra/http/wallet-exception.filter";
import { WalletsModule } from "../../src/wallets.module";

const adminUrl = "postgres://wagering:wagering@localhost:5432/postgres";
const databaseUrl = "postgres://wagering:wagering@localhost:5432/wagering_wallets";
let app: NestExpressApplication;
let orm: MikroORM;
let baseUrl = "";

@Module({
  imports: [DatabaseModule.forRoot(databaseUrl), WalletsModule],
})
class OpenWalletHttpModule {}

beforeAll(async () => {
  Logger.overrideLogger(false);
  const admin = await initOrm(adminUrl);
  await admin.em.getConnection().execute("create database wagering_wallets").catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("already exists")) {
      throw error;
    }
  });
  await admin.close(true);

  orm = await initOrm(databaseUrl);
  await orm.migrator.up();

  app = await NestFactory.create(OpenWalletHttpModule, { logger: false });
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

describe("POST /wallets", () => {
  test("persists the opening credit in the same commit and reads it back", async () => {
    const playerId = randomUUID();
    const created = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "1000.00", currency: "BRL" },
      }),
    });
    const body = (await created.json()) as { id: string; balance: { amount: string }; version: number };

    expect(created.status).toBe(201);
    expect(body).toEqual({
      id: body.id,
      playerId,
      balance: { amount: "1000.00", currency: "BRL" },
      version: 1,
    });

    const stored = await orm.em.getConnection().execute<Array<{ balance: string; kind: string; direction: string; entries: string }>>(
      `select w.balance::text as balance,
              t.kind,
              l.direction,
              (select count(*) from wallet_ledger_entries where wallet_id = w.id)::text as entries
       from wallets w
       join wager_transactions t on t.wallet_id = w.id
       join wallet_ledger_entries l on l.transaction_id = t.id
       where w.id = ?::uuid`,
      [body.id],
    );
    expect(stored).toEqual([
      { balance: "1000.00", kind: "OPENING", direction: "CREDIT", entries: "1" },
    ]);

    const loaded = await fetch(`${baseUrl}/wallets/${body.id}`);
    expect(loaded.status).toBe(200);
    expect(await loaded.json()).toEqual(body);
  });

  test("rejects a duplicate player and currency, an invalid amount, and a zero opening", async () => {
    const playerId = randomUUID();
    const created = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "10.00", currency: "BRL" },
      }),
    });
    expect(created.status).toBe(201);

    const duplicate = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "10.00", currency: "BRL" },
      }),
    });
    expect(duplicate.status).toBe(409);

    const invalid = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        playerId: randomUUID(),
        initialBalance: { amount: "10.999", currency: "BRL" },
      }),
    });
    expect(invalid.status).toBe(400);

    const zero = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        playerId: randomUUID(),
        initialBalance: { amount: "0.00", currency: "USD" },
      }),
    });
    const zeroBody = (await zero.json()) as { id: string; balance: { amount: string; currency: string }; version: number };
    expect(zero.status).toBe(201);
    expect(zeroBody.balance).toEqual({ amount: "0.00", currency: "USD" });
    expect(zeroBody.version).toBe(1);

    const rows = await orm.em.getConnection().execute<Array<{ count: string }>>(
      `select count(*)::text as count from wallet_ledger_entries where wallet_id = ?::uuid`,
      [zeroBody.id],
    );
    expect(rows[0]?.count).toBe("0");

    const missing = await fetch(`${baseUrl}/wallets/44444444-4444-4444-8444-444444444444`);
    expect(missing.status).toBe(404);
  });
});
