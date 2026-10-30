import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Logger } from "@nestjs/common";
import type { MikroORM } from "@mikro-orm/postgresql";
import { initOrm } from "../../src/infra/database/orm-config";

const adminUrl = "postgres://wagering:wagering@localhost:5432/postgres";
const databaseUrl = "postgres://wagering:wagering@localhost:5432/wagering_instances";
const missingWalletId = "00000000-0000-4000-8000-000000000001";

let orm: MikroORM;
const children: ChildProcess[] = [];
const logs: string[] = [];
let bases: string[] = [];

beforeAll(async () => {
  Logger.overrideLogger(false);
  const admin = await initOrm(adminUrl);
  await admin.em.getConnection().execute("create database wagering_instances").catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("already exists")) {
      throw error;
    }
  });
  await admin.close(true);

  orm = await initOrm(databaseUrl);
  await orm.migrator.up();

  const ports = [await freePort(), await freePort(), await freePort()];
  for (const port of ports) {
    children.push(startInstance(port));
  }
  bases = ports.map((port) => `http://127.0.0.1:${port}`);
  await Promise.all(bases.map((base) => waitReady(base)));
}, 40_000);

afterAll(async () => {
  for (const child of children) {
    if (child.exitCode === null) {
      child.kill();
    }
  }
  await Promise.race([
    Promise.all(children.map((child) => new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      child.once("exit", () => resolve());
    }))),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  await orm.close(true);
}, 10_000);

describe("three application processes", () => {
  test("two bets of 80 sent to different processes leave one debit", async () => {
    const playerId = randomUUID();
    const walletId = await openWallet(bases[0]!, playerId, "100.00");
    const [first, second] = await Promise.all([
      postWager(bases[0]!, bet(playerId, walletId, "80.00")),
      postWager(bases[1]!, bet(playerId, walletId, "80.00")),
    ]);

    const processed = [first, second].filter((result) => result.body.status === "PROCESSED");
    const rejected = [first, second].filter((result) => result.body.status === "REJECTED");
    expect(processed).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(processed[0]?.status).toBe(201);
    expect(rejected[0]?.status).toBe(422);
    expect(rejected[0]?.body.failureCode).toBe("INSUFFICIENT_BALANCE");

    const replayed = await postWager(bases[2]!, processed[0]!.request);
    expect(replayed.status).toBe(201);
    expect(replayed.body).toMatchObject({
      transactionId: processed[0]?.body.transactionId,
      balance: { amount: "20.00", currency: "BRL" },
      idempotentReplay: true,
    });
    expect(await walletSnapshot(walletId)).toEqual({
      balance: "20.00",
      version: "2",
      reconstructed: "20.00",
      debits: "1",
    });
  }, 30_000);

  test("fifty copies of one bet across the three processes debit once", async () => {
    const playerId = randomUUID();
    const walletId = await openWallet(bases[1]!, playerId, "100.00");
    const body = bet(playerId, walletId, "10.00");
    const results = await Promise.all(bases.map((base) => postWager(base, body)).concat(
      Array.from({ length: 47 }, (_, index) => postWager(bases[index % bases.length]!, body)),
    ));

    expect(results).toHaveLength(50);
    expect(results.every((result) => result.status === 201)).toBe(true);
    expect(results.filter((result) => result.body.idempotentReplay === false)).toHaveLength(1);
    expect(results.every((result) => result.body.transactionId === results[0]?.body.transactionId)).toBe(true);
    expect(await walletSnapshot(walletId)).toEqual({
      balance: "90.00",
      version: "2",
      reconstructed: "90.00",
      debits: "1",
    });
  }, 30_000);
});

function startInstance(port: number): ChildProcess {
  let output = "";
  const child = spawn(process.execPath, ["src/main.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), DATABASE_URL: databaseUrl },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const append = (chunk: Buffer): void => {
    output = (output + chunk.toString()).slice(-4_000);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.once("exit", () => {
    logs.push(output);
  });
  return child;
}

async function waitReady(base: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  let last = "not started";
  while (Date.now() < deadline) {
    if (children.some((child) => child.exitCode !== null)) {
      throw new Error(`an instance exited before it was ready\n${logs.join("\n")}`);
    }
    try {
      const response = await fetch(`${base}/wallets/${missingWalletId}`);
      if (response.status === 404) {
        return;
      }
      last = `status ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : "connection refused";
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`instance ${base} did not start: ${last}\n${logs.join("\n")}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function bet(playerId: string, walletId: string, amount: string): Record<string, unknown> {
  return {
    providerId: "provider-a",
    externalTransactionId: randomUUID(),
    playerId,
    walletId,
    roundId: "round-instances",
    gameId: "fortune-chimp",
    kind: "BET",
    money: { amount, currency: "BRL" },
  };
}

async function openWallet(base: string, playerId: string, amount: string): Promise<string> {
  const response = await fetch(`${base}/wallets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId, initialBalance: { amount, currency: "BRL" } }),
  });
  const body = (await response.json()) as { id: string };
  expect(response.status).toBe(201);
  return body.id;
}

async function postWager(base: string, body: Record<string, unknown>): Promise<{
  status: number;
  body: Record<string, unknown>;
  request: Record<string, unknown>;
}> {
  const response = await fetch(`${base}/wagering/transactions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `${body.providerId as string}:${body.externalTransactionId as string}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
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
