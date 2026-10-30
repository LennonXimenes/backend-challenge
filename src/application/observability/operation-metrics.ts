const STATUSES = ["PENDING_REFERENCE", "PROCESSED", "REJECTED", "FAILED"] as const;

type TransactionStatus = (typeof STATUSES)[number];

export interface MetricsSnapshot {
  transactionsByStatus: Record<TransactionStatus, number>;
  duplicates: number;
  retries: number;
  dlq: number;
  lockConflicts: number;
  outboxLagMs: number | null;
  reconciliationDivergences: number;
  latencyMsCount: number;
  latencyMsSum: number;
}

const counters = {
  transactionsByStatus: emptyStatuses(),
  duplicates: 0,
  retries: 0,
  dlq: 0,
  lockConflicts: 0,
  reconciliationDivergences: 0,
  outboxLagMs: null as number | null,
  latencyMsCount: 0,
  latencyMsSum: 0,
};

export function recordWager(status: string, duplicate: boolean, latencyMs: number): void {
  if (duplicate) {
    counters.duplicates += 1;
  } else if (isStatus(status)) {
    counters.transactionsByStatus[status] += 1;
  }

  const latency = wholeMilliseconds(latencyMs);
  if (latency !== undefined) {
    counters.latencyMsCount += 1;
    counters.latencyMsSum += latency;
  }
}

export function recordRetry(): void {
  counters.retries += 1;
}

export function recordDlq(): void {
  counters.dlq += 1;
}

export function recordLockConflict(): void {
  counters.lockConflicts += 1;
}

export function recordReconciliationDivergence(): void {
  counters.reconciliationDivergences += 1;
}

export function recordOutboxLag(lagMs: number): void {
  const lag = wholeMilliseconds(lagMs);
  if (lag !== undefined) {
    counters.outboxLagMs = lag;
  }
}

export function isLockConflict(error: unknown): boolean {
  const text = errorText(error).toLowerCase();
  return text.includes("40p01") || text.includes("55p03") || text.includes("deadlock") || text.includes("lock timeout");
}

export function metricsSnapshot(): MetricsSnapshot {
  return {
    transactionsByStatus: { ...counters.transactionsByStatus },
    duplicates: counters.duplicates,
    retries: counters.retries,
    dlq: counters.dlq,
    lockConflicts: counters.lockConflicts,
    reconciliationDivergences: counters.reconciliationDivergences,
    outboxLagMs: counters.outboxLagMs,
    latencyMsCount: counters.latencyMsCount,
    latencyMsSum: counters.latencyMsSum,
  };
}

export function resetMetrics(): void {
  counters.transactionsByStatus = emptyStatuses();
  counters.duplicates = 0;
  counters.retries = 0;
  counters.dlq = 0;
  counters.lockConflicts = 0;
  counters.reconciliationDivergences = 0;
  counters.outboxLagMs = null;
  counters.latencyMsCount = 0;
  counters.latencyMsSum = 0;
}

function emptyStatuses(): Record<TransactionStatus, number> {
  return {
    PENDING_REFERENCE: 0,
    PROCESSED: 0,
    REJECTED: 0,
    FAILED: 0,
  };
}

function isStatus(status: string): status is TransactionStatus {
  return (STATUSES as readonly string[]).includes(status);
}

function wholeMilliseconds(value: number): number | undefined {
  if (!Number.isInteger(value) || value < 0) {
    return undefined;
  }

  return value;
}

function errorText(error: unknown): string {
  const parts: string[] = [];
  const queue: unknown[] = [error];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") {
      continue;
    }

    if (current instanceof Error) {
      parts.push(current.message);
    }

    if ("code" in current && typeof current.code === "string") {
      parts.push(current.code);
    }

    if ("cause" in current) {
      queue.push(current.cause);
    }
  }

  return parts.join(" ");
}
