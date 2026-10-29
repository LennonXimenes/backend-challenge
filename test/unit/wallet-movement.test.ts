import { describe, expect, test } from "bun:test";
import { Money } from "../../src/domain/money/money";
import { CurrencyMismatchError } from "../../src/domain/money/money-error";
import { LedgerDirection } from "../../src/domain/wallet/ledger-direction";
import { InsufficientBalanceError } from "../../src/domain/wallet/wallet-error";
import { Wallet } from "../../src/domain/wallet/wallet";
import { FailureCode } from "../../src/domain/wager/failure-code";
import { InvalidTransactionStateError, WagerTransaction, WagerTransactionKind, WagerTransactionStatus } from "../../src/domain/wager/wager-transaction";

const at = new Date("2026-10-29T23:00:00.000Z");
const walletId = "11111111-1111-4111-8111-111111111111";
const playerId = "22222222-2222-4222-8222-222222222222";
const transactionId = "33333333-3333-4333-8333-333333333333";
const ledgerId = "44444444-4444-4444-8444-444444444444";
const openingTransactionId = "55555555-5555-4555-8555-555555555555";
const openingLedgerId = "66666666-6666-4666-8666-666666666666";

function openedWallet() {
  return Wallet.open({
    id: walletId,
    playerId,
    initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    openedAt: at,
    openingTransactionId,
    openingLedgerId,
  }).wallet;
}

describe("wallet movements", () => {
  test("debit and credit move the balance and the version", () => {
    const wallet = openedWallet();
    const debit = wallet.debit({
      money: Money.from({ amount: "80.00", currency: "BRL" }),
      at,
      ledgerId,
      transactionId,
    });

    expect(debit.direction).toBe(LedgerDirection.Debit);
    expect(debit.balanceAfter.toJSON().amount).toBe("20.00");
    expect(wallet.version).toBe(2);

    const credit = wallet.credit({
      money: Money.from({ amount: "5.00", currency: "BRL" }),
      at,
      ledgerId: "77777777-7777-4777-8777-777777777777",
      transactionId: "88888888-8888-4888-8888-888888888888",
    });

    expect(credit.direction).toBe(LedgerDirection.Credit);
    expect(wallet.balance.toJSON().amount).toBe("25.00");
    expect(wallet.version).toBe(3);
  });

  test("an insufficient debit does not change the wallet", () => {
    const wallet = openedWallet();

    expect(() =>
      wallet.debit({
        money: Money.from({ amount: "100.01", currency: "BRL" }),
        at,
        ledgerId,
        transactionId,
      }),
    ).toThrow(InsufficientBalanceError);
    expect(wallet.balance.toJSON().amount).toBe("100.00");
    expect(wallet.version).toBe(1);
  });

  test("a different currency does not change the wallet", () => {
    const wallet = openedWallet();

    expect(() =>
      wallet.credit({
        money: Money.from({ amount: "1.00", currency: "USD" }),
        at,
        ledgerId,
        transactionId,
      }),
    ).toThrow(CurrencyMismatchError);
    expect(wallet.version).toBe(1);
  });

  test("a submitted transaction starts pending and terminal states do not move again", () => {
    const transaction = WagerTransaction.create({
      id: transactionId,
      providerId: "provider-a",
      externalTransactionId: "transaction-1",
      idempotencyKey: "provider-a:transaction-1",
      payloadHash: "hash",
      walletId,
      playerId,
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: "10.00", currency: "BRL" }),
      createdAt: at,
    });

    expect(transaction.status).toBe(WagerTransactionStatus.Pending);
    transaction.reject(FailureCode.InsufficientBalance);
    expect(transaction.failureCode).toBe(FailureCode.InsufficientBalance);
    expect(() => transaction.markProcessed(at)).toThrow(InvalidTransactionStateError);
    expect(() => transaction.fail("INFRA")).toThrow(InvalidTransactionStateError);
    expect(() => WagerTransaction.create({
      id: transactionId,
      providerId: "internal",
      externalTransactionId: walletId,
      idempotencyKey: "internal:opening",
      payloadHash: "hash",
      walletId,
      playerId,
      roundId: "opening",
      gameId: "opening",
      kind: WagerTransactionKind.Opening,
      money: Money.from({ amount: "10.00", currency: "BRL" }),
      createdAt: at,
    })).toThrow(InvalidTransactionStateError);
  });
});
