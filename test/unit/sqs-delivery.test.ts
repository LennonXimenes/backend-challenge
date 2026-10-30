import { describe, expect, test } from "bun:test";
import { InvalidWalletInputError } from "../../src/domain/wallet/wallet-error";
import { failedDelivery, visibilityDelaySeconds } from "../../src/infra/sqs/delivery";

describe("sqs delivery", () => {
  test("backs off by 1s, 2s, 4s and sends a permanent failure straight to the dlq", () => {
    expect(visibilityDelaySeconds(1)).toBe(1);
    expect(visibilityDelaySeconds(2)).toBe(2);
    expect(visibilityDelaySeconds(3)).toBe(4);
    expect(failedDelivery(new InvalidWalletInputError("kind"), 1)).toBe("dlq");
    expect(failedDelivery(new Error("connection reset"), 1)).toBe("retry");
    expect(failedDelivery(new Error("connection reset"), 5)).toBe("dlq");
  });
});
