export interface OperationLog {
  level: "info" | "error";
  message: string;
  correlationId?: string | null;
  messageId?: string | null;
  transactionId?: string | null;
  walletId?: string | null;
  providerId?: string | null;
  outcome?: string | null;
  error?: string | null;
}

export function operationLog(input: OperationLog): string {
  const line: Record<string, string | null> = {
    level: input.level,
    message: text(input.message) ?? "log",
    correlationId: text(input.correlationId),
    messageId: text(input.messageId),
    transactionId: text(input.transactionId),
    walletId: text(input.walletId),
    providerId: text(input.providerId),
  };

  const outcome = text(input.outcome);
  if (outcome) {
    line.outcome = outcome;
  }

  const error = text(input.error);
  if (error) {
    line.error = error;
  }

  return JSON.stringify(line);
}

export function writeOperationLog(input: OperationLog): void {
  const line = operationLog(input);
  if (input.level === "error") {
    console.error(line);
    return;
  }

  console.info(line);
}

function text(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
