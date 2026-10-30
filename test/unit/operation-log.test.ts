import { describe, expect, test } from "bun:test";
import { operationLog } from "../../src/application/observability/operation-log";

describe("operation log", () => {
  test("writes the correlation fields and drops the financial payload", () => {
    const line = operationLog({
      level: "info",
      message: "wager submitted",
      correlationId: "corr-1",
      messageId: "msg-1",
      transactionId: "tx-1",
      walletId: "wallet-1",
      providerId: "provider-a",
      outcome: "PROCESSED",
      ...{
        amount: 10,
        balance: { amount: "10.00", currency: "BRL" },
        money: { amount: 10.5 },
        payload: { money: { amount: "25.00" } },
        initialBalance: "100.00",
      },
    });

    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed).toEqual({
      level: "info",
      message: "wager submitted",
      correlationId: "corr-1",
      messageId: "msg-1",
      transactionId: "tx-1",
      walletId: "wallet-1",
      providerId: "provider-a",
      outcome: "PROCESSED",
    });
    for (const value of Object.values(parsed)) {
      expect(typeof value === "string" || value === null).toBe(true);
    }
    expect(line).not.toContain("10.00");
    expect(line).not.toContain("10.5");
    expect(line).not.toContain("amount");
    expect(line).not.toContain("balance");
  });

  test("keeps the ids when the financial fields are missing and rejects a numeric id", () => {
    const line = operationLog({
      level: "error",
      message: "wager consume failed",
      correlationId: "   ",
      error: "WalletNotFoundError",
      ...{ transactionId: 42, walletId: 7 },
    });

    expect(JSON.parse(line)).toEqual({
      level: "error",
      message: "wager consume failed",
      correlationId: null,
      messageId: null,
      transactionId: null,
      walletId: null,
      providerId: null,
      error: "WalletNotFoundError",
    });
  });
});
