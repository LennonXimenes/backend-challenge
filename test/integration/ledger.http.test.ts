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
const databaseUrl = "postgres://wagering:wagering@localhost:5432/wagering_ledger";

let app: NestExpressApplication;
let orm: MikroORM;
let baseUrl = "";

@Module({
  imports: [DatabaseModule.forRoot(databaseUrl), WalletsModule, WageringModule],
})
class LedgerHttpModule {}

beforeAll(async () => {
  Logger.overrideLogger(false);
  const admin = await initOrm(adminUrl);
  await admin.em.getConnection().execute("create database wagering_ledger").catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("already exists")) {
      throw error;
    }
  });
  await admin.close(true);

  orm = await initOrm(databaseUrl);
  await orm.migrator.up();
  app = await NestFactory.create(LedgerHttpModule, { logger: false });
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

describe("GET /wallets/:walletId/ledger", () => {
  test("pages a stable cursor and keeps money as decimal strings", async () => {
    const playerId = randomUUID();
    const opened = await postJson("/wallets", {
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });
    const walletId = opened.body.id as string;
    await postWager(playerId, walletId, "10.00");

    const first = await getLedger(walletId, { limit: "1" });
    expect(first.status).toBe(200);
    const firstBody = first.body as LedgerBody;
    expect(firstBody.entries).toHaveLength(1);
    expect(firstBody.entries[0]).toMatchObject({
      direction: "CREDIT",
      money: { amount: "100.00", currency: "BRL" },
      balanceBefore: { amount: "0.00", currency: "BRL" },
      balanceAfter: { amount: "100.00", currency: "BRL" },
    });
    expect(typeof firstBody.entries[0]?.money.amount).toBe("string");
    expect(typeof firstBody.nextCursor).toBe("string");
    const cursor = firstBody.nextCursor ?? "";
    expect(cursor).not.toBe(firstBody.entries[0]?.id);

    const second = await getLedger(walletId, { limit: "1", cursor });
    const secondBody = second.body as LedgerBody;
    expect(secondBody.entries).toHaveLength(1);
    expect(secondBody.entries[0]).toMatchObject({
      direction: "DEBIT",
      money: { amount: "10.00", currency: "BRL" },
      balanceAfter: { amount: "90.00", currency: "BRL" },
    });
    const repeated = await getLedger(walletId, { limit: "1", cursor });
    expect((repeated.body as LedgerBody).entries[0]?.id).toBe(secondBody.entries[0]?.id);

    expect(secondBody.nextCursor).toBeNull();
    await postWager(playerId, walletId, "5.00");
    const stillSecond = await getLedger(walletId, { limit: "1", cursor });
    const stillSecondBody = stillSecond.body as LedgerBody;
    expect(stillSecondBody.entries[0]?.id).toBe(secondBody.entries[0]?.id);

    const third = await getLedger(walletId, { limit: "1", cursor: stillSecondBody.nextCursor ?? "" });
    expect((third.body as LedgerBody).entries[0]).toMatchObject({
      direction: "DEBIT",
      money: { amount: "5.00", currency: "BRL" },
    });

    const missing = await getLedger(randomUUID(), {});
    expect(missing.status).toBe(404);
    const invalid = await getLedger(walletId, { cursor: "1" });
    expect(invalid.status).toBe(400);

    const emptyWallet = await postJson("/wallets", {
      playerId: randomUUID(),
      initialBalance: { amount: "0.00", currency: "BRL" },
    });
    const empty = await getLedger(emptyWallet.body.id as string, {});
    expect(empty.body).toEqual({ entries: [], nextCursor: null });
  }, 20_000);
});

interface LedgerBody {
  entries: Array<{
    id: string;
    direction: string;
    money: { amount: string; currency: string };
    balanceBefore: { amount: string; currency: string };
    balanceAfter: { amount: string; currency: string };
  }>;
  nextCursor: string | null;
}

async function postJson(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function postWager(playerId: string, walletId: string, amount: string): Promise<void> {
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
      roundId: "round-ledger",
      gameId: "fortune-chimp",
      kind: "BET",
      money: { amount, currency: "BRL" },
    }),
  });
  if (response.status !== 201) {
    throw new Error(`bet failed with ${response.status}`);
  }
}

async function getLedger(walletId: string, query: { cursor?: string; limit?: string }): Promise<{ status: number; body: unknown }> {
  const params = new URLSearchParams();
  if (query.cursor !== undefined) {
    params.set("cursor", query.cursor);
  }
  if (query.limit !== undefined) {
    params.set("limit", query.limit);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const response = await fetch(`${baseUrl}/wallets/${walletId}/ledger${suffix}`);
  return { status: response.status, body: await response.json() };
}
