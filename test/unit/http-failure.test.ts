import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Controller, Get, Logger, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { httpFailure } from "../../src/application/http/http-failure";
import { InvalidMoneyError } from "../../src/domain/money/money-error";
import { InvalidWalletInputError, WalletAlreadyExistsError, WalletNotFoundError } from "../../src/domain/wallet/wallet-error";
import { TransactionNotFoundError, WagerConflictError } from "../../src/domain/wager/wager-error";
import { WalletExceptionFilter } from "../../src/infra/http/wallet-exception.filter";

@Controller("probe")
class ProbeController {
  @Get("transient")
  transient(): void {
    throw Object.assign(new Error("deadlock detected"), { code: "40P01" });
  }

  @Get("down")
  down(): void {
    throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
  }

  @Get("bug")
  bug(): void {
    throw new Error("programmer");
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

let app: NestExpressApplication;
let baseUrl = "";

beforeAll(async () => {
  Logger.overrideLogger(false);
  app = await NestFactory.create(ProbeModule, { logger: false });
  app.useGlobalFilters(new WalletExceptionFilter());
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app.close();
});

describe("HTTP failure map", () => {
  test("separates invalid payload, conflict, absence, outage and a programming error", () => {
    expect(httpFailure(new InvalidMoneyError("25.001"))).toEqual({ status: 400, body: { error: "invalid_payload" } });
    expect(httpFailure(new InvalidWalletInputError("walletId must be a uuid"))).toEqual({ status: 400, body: { error: "invalid_payload" } });
    expect(httpFailure(new WalletAlreadyExistsError("player", "BRL"))).toEqual({ status: 409, body: { error: "wallet_conflict" } });
    expect(httpFailure(new WagerConflictError())).toEqual({ status: 409, body: { error: "transaction_conflict" } });
    expect(httpFailure(new WalletNotFoundError("11111111-1111-4111-8111-111111111111"))).toEqual({ status: 404, body: { error: "wallet_not_found" } });
    expect(httpFailure(new TransactionNotFoundError("22222222-2222-4222-8222-222222222222"))).toEqual({ status: 404, body: { error: "transaction_not_found" } });
    expect(httpFailure(Object.assign(new Error("deadlock detected"), { code: "40P01" }))).toEqual({ status: 503, body: { error: "unavailable" } });
    expect(httpFailure(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))).toEqual({ status: 503, body: { error: "unavailable" } });
    expect(httpFailure(new Error("programmer"))).toEqual({ status: 500, body: { error: "internal" } });
  });

  test("the shared filter hides the cause and lets the caller retry only the outage", async () => {
    const transient = await fetch(`${baseUrl}/probe/transient`);
    const down = await fetch(`${baseUrl}/probe/down`);
    const bug = await fetch(`${baseUrl}/probe/bug`);

    expect(transient.status).toBe(503);
    expect(await transient.json()).toEqual({ error: "unavailable" });
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ error: "unavailable" });
    expect(bug.status).toBe(500);
    expect(await bug.json()).toEqual({ error: "internal" });
  });
});
