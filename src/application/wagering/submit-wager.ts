import { randomUUID } from "node:crypto";
import { Money } from "../../domain/money/money";
import { WagerTransactionKind, WagerTransactionStatus } from "../../domain/wager/wager-transaction";
import { WagerRepository } from "./wager-repository";

export interface SubmitWagerCommand {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind.Bet | WagerTransactionKind.Win | WagerTransactionKind.Loss | WagerTransactionKind.Refund | WagerTransactionKind.Rollback;
  money: Money;
  referenceExternalTransactionId?: string;
}

export interface SubmitWagerBody {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: { amount: string; currency: string };
  failureCode?: string;
  idempotentReplay: boolean;
}

export interface SubmitWagerResult {
  httpStatus: number;
  body: SubmitWagerBody;
}

export class SubmitWager {
  constructor(private readonly wagers: WagerRepository) {}

  execute(command: SubmitWagerCommand): Promise<SubmitWagerResult> {
    return this.wagers.submit({
      ...command,
      transactionId: randomUUID(),
      ledgerId: randomUUID(),
      at: new Date(),
    });
  }
}

export function httpStatusFor(status: WagerTransactionStatus): number {
  if (status === WagerTransactionStatus.Processed) {
    return 201;
  }

  if (status === WagerTransactionStatus.PendingReference) {
    return 202;
  }

  return 422;
}
