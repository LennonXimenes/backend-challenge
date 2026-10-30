import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Logger, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { MikroORM } from "@mikro-orm/postgresql";
import { metricsSnapshot, resetMetrics } from "../../src/application/observability/operation-metrics";
import { DatabaseModule } from "../../src/infra/database/database.module";
import { initOrm } from "../../src/infra/database/orm-config";
import { WalletExceptionFilter } from "../../src/infra/http/wallet-exception.filter";
import { WageringModule } from "../../src/wagering.module";
import { WalletsModule } from "../../src/wallets.module";

const adminUrl = "postgres://wagering:wagering@localhost:5432/postgres";
const databaseUrl = "postgres://wagering:wagering@localhost:5432/wagering_reconcile";

let app: NestExpressApplication;
let orm: MikroORM;
let baseUrl = "";

@Module({
  imports: [DatabaseModule.forRoot(databaseUrl), WalletsModule, WageringModule],
})
class ReconciliationHttpModule {}

beforeAll(async () => {
  Logger.overrideLogger(false);
  const admin = await initOrm(adminUrl);
  await admin.em.getConnection().execute("create database wagering_reconcile").catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("already exists")) {
      throw error;
    }
  });
  await admin.close(true);

  orm = await initOrm(databaseUrl);
  await orm.migrator.up();
  app = await NestFactory.create(ReconciliationHttpModule, { logger: false });
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

describe("POST /wallets/:walletId/reconciliation", () => {
  test("reports a divergence and leaves the stored balance untouched", async () => {
    resetMetrics();
    const playerId = randomUUID();
    const opened = await postJson("/wallets", {
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });
    const walletId = opened.body.id as string;
    await postWager(playerId, walletId, "10.00");

    const consistent = await reconcile(walletId);
    expect(consistent.status).toBe(200);
    expect(consistent.body).toEqual({
      walletId,
      storedBalance: { amount: "90.00", currency: "BRL" },
      calculatedBalance: { amount: "90.00", currency: "BRL" },
      difference: { amount: "0.00", currency: "BRL" },
      consistent: true,
      checkedEntries: 2,
    });
    expect(metricsSnapshot().reconciliationDivergences).toBe(0);

    await orm.em.getConnection().execute(
      "update wallets set balance = '80.00' where id = ?::uuid",
      [walletId],
    );
    const lines: string[] = [];
    const original = console.error;
    console.error = (line?: unknown) => {
      lines.push(String(line));
    };
    let divergent: { status: number; body: unknown };
    try {
      divergent = await reconcile(walletId);
    } finally {
      console.error = original;
    }

    expect(divergent.status).toBe(200);
    expect(divergent.body).toEqual({
      walletId,
      storedBalance: { amount: "80.00", currency: "BRL" },
      calculatedBalance: { amount: "90.00", currency: "BRL" },
      difference: { amount: "-10.00", currency: "BRL" },
      consistent: false,
      checkedEntries: 2,
    });
    expect(lines.some((line) => line.includes("reconciliation diverged") && line.includes(walletId) && !line.includes("80.00") && !line.includes("90.00"))).toBe(true);
    expect(metricsSnapshot().reconciliationDivergences).toBe(1);

    const stored = await fetch(`${baseUrl}/wallets/${walletId}`);
    expect(await stored.json()).toMatchObject({
      balance: { amount: "80.00", currency: "BRL" },
    });

    const missing = await reconcile(randomUUID());
    expect(missing.status).toBe(404);
    const invalid = await reconcile("not-a-uuid");
    expect(invalid.status).toBe(400);
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
      roundId: "round-reconcile",
      gameId: "fortune-chimp",
      kind: "BET",
      money: { amount, currency: "BRL" },
    }),
  });
  if (response.status !== 201) {
    throw new Error(`bet failed with ${response.status}`);
  }
}

async function reconcile(walletId: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}/wallets/${walletId}/reconciliation`, { method: "POST" });
  return { status: response.status, body: await response.json() };
}
