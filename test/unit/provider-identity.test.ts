import { describe, expect, test } from "bun:test";
import { decideMovement } from "../../src/application/wagering/decide-movement";
import { IdentityNotConfiguredError, UnconfiguredIdentity } from "../../src/application/auth/provider-identity";
import { OpenAccessGuard } from "../../src/infra/http/open-access.guard";
import { Money } from "../../src/domain/money/money";
import { Wallet } from "../../src/domain/wallet/wallet";
import { FailureCode } from "../../src/domain/wager/failure-code";
import { WagerTransactionKind, WagerTransactionStatus } from "../../src/domain/wager/wager-transaction";

const at = new Date("2026-10-30T15:00:00.000Z");
const walletId = "11111111-1111-4111-8111-111111111111";
const playerId = "22222222-2222-4222-8222-222222222222";

describe("auth extension", () => {
  test("leaves access open and rejects a provider token until an identity provider exists", async () => {
    const guard = new OpenAccessGuard();
    expect(guard.canActivate({} as never)).toBe(true);
    await expect(new UnconfiguredIdentity().authenticate("token")).rejects.toThrow(IdentityNotConfiguredError);
  });

  test("rejects a wager whose player is not the wallet owner", () => {
    const wallet = Wallet.open({
      id: walletId,
      playerId,
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      openedAt: at,
      openingTransactionId: "55555555-5555-4555-8555-555555555555",
      openingLedgerId: "66666666-6666-4666-8666-666666666666",
    }).wallet;

    const decision = decideMovement(wallet, {
      transactionId: "33333333-3333-4333-8333-333333333333",
      ledgerId: "44444444-4444-4444-8444-444444444444",
      providerId: "provider-a",
      externalTransactionId: "bet-1",
      idempotencyKey: "provider-a:bet-1",
      playerId: "99999999-9999-4999-8999-999999999999",
      walletId,
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: "10.00", currency: "BRL" }),
      at,
    });

    expect(decision.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(decision.transaction.failureCode).toBe(FailureCode.PlayerMismatch);
    expect(decision.entry).toBeUndefined();
  });
});
