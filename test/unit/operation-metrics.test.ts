import { beforeEach, describe, expect, test } from "bun:test";
import {
  isLockConflict,
  metricsSnapshot,
  recordDlq,
  recordLockConflict,
  recordOutboxLag,
  recordRetry,
  recordWager,
  resetMetrics,
} from "../../src/application/observability/operation-metrics";

describe("operation metrics", () => {
  beforeEach(() => {
    resetMetrics();
  });

  test("counts status, duplicates, retries, dlq, lock conflicts, outbox lag and latency", () => {
    recordWager("PROCESSED", false, 20);
    recordWager("PROCESSED", false, 10);
    recordWager("REJECTED", false, 5);
    recordWager("PENDING_REFERENCE", false, 0);
    recordWager("FAILED", false, 1);
    recordWager("PROCESSED", true, 4);
    recordRetry();
    recordDlq();
    recordLockConflict();
    recordOutboxLag(1500);

    expect(metricsSnapshot()).toEqual({
      transactionsByStatus: {
        PENDING_REFERENCE: 1,
        PROCESSED: 2,
        REJECTED: 1,
        FAILED: 1,
      },
      duplicates: 1,
      retries: 1,
      dlq: 1,
      lockConflicts: 1,
      reconciliationDivergences: 0,
      outboxLagMs: 1500,
      latencyMsCount: 6,
      latencyMsSum: 40,
    });
  });

  test("ignores a numeric amount and a fractional latency", () => {
    recordWager("10.00", false, 1.5);
    recordOutboxLag(2.5);
    recordOutboxLag(-1);

    expect(metricsSnapshot()).toEqual({
      transactionsByStatus: {
        PENDING_REFERENCE: 0,
        PROCESSED: 0,
        REJECTED: 0,
        FAILED: 0,
      },
      duplicates: 0,
      retries: 0,
      dlq: 0,
      lockConflicts: 0,
      reconciliationDivergences: 0,
      outboxLagMs: null,
      latencyMsCount: 0,
      latencyMsSum: 0,
    });
    expect(isLockConflict(Object.assign(new Error("deadlock detected"), { code: "40P01" }))).toBe(true);
    expect(isLockConflict(new Error("balance 10.00"))).toBe(false);
  });
});
