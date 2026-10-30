import type { Money } from "../../domain/money/money";
import type { WagerTransactionKind } from "../../domain/wager/wager-transaction";
import type { SubmitWagerResult } from "./submit-wager";

export interface StoredWager {
  transactionId: string;
  ledgerId: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind.Bet | WagerTransactionKind.Win | WagerTransactionKind.Loss | WagerTransactionKind.Refund;
  money: Money;
  referenceExternalTransactionId?: string;
  at: Date;
}

export abstract class WagerRepository {
  abstract submit(input: StoredWager): Promise<SubmitWagerResult>;
}
