import { InvalidWalletInputError, WalletNotFoundError } from "../../domain/wallet/wallet-error";
import { WagerConflictError } from "../../domain/wager/wager-error";

export const SQS_ATTEMPT_LIMIT = 5;
export const WAGER_CONSUMER_NAME = "wager-transactions";

export function visibilityDelaySeconds(receiveCount: number): number {
  const exponent = Math.max(0, receiveCount - 1);
  return Math.min(2 ** exponent, 60);
}

export function permanentFailure(error: unknown): boolean {
  return error instanceof InvalidWalletInputError
    || error instanceof WalletNotFoundError
    || error instanceof WagerConflictError
    || error instanceof SyntaxError;
}

export function failedDelivery(error: unknown, receiveCount: number): "retry" | "dlq" {
  if (permanentFailure(error) || receiveCount >= SQS_ATTEMPT_LIMIT) {
    return "dlq";
  }

  return "retry";
}
