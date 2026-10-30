import { InvalidMoneyError } from "../../domain/money/money-error";
import { InvalidWalletInputError, WalletAlreadyExistsError, WalletNotFoundError } from "../../domain/wallet/wallet-error";
import { TransactionNotFoundError, WagerConflictError } from "../../domain/wager/wager-error";
import { isTransientFailure } from "../observability/operation-metrics";

export interface HttpFailure {
  status: number;
  body: { error: string };
}

export function httpFailure(exception: unknown): HttpFailure {
  if (exception instanceof InvalidMoneyError || exception instanceof InvalidWalletInputError) {
    return { status: 400, body: { error: "invalid_payload" } };
  }

  if (exception instanceof WalletAlreadyExistsError) {
    return { status: 409, body: { error: "wallet_conflict" } };
  }

  if (exception instanceof WagerConflictError) {
    return { status: 409, body: { error: "transaction_conflict" } };
  }

  if (exception instanceof WalletNotFoundError) {
    return { status: 404, body: { error: "wallet_not_found" } };
  }

  if (exception instanceof TransactionNotFoundError) {
    return { status: 404, body: { error: "transaction_not_found" } };
  }

  if (isTransientFailure(exception)) {
    return { status: 503, body: { error: "unavailable" } };
  }

  return { status: 500, body: { error: "internal" } };
}
