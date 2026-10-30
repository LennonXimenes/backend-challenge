import type { Money } from "../../domain/money/money";
import type { WagerTransactionKind } from "../../domain/wager/wager-transaction";
import type { ConsumeResult, SubmitWagerResult } from "./submit-wager";

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
  kind: WagerTransactionKind.Bet | WagerTransactionKind.Win | WagerTransactionKind.Loss | WagerTransactionKind.Refund | WagerTransactionKind.Rollback;
  money: Money;
  referenceExternalTransactionId?: string;
  at: Date;
}

export interface InboxClaim {
  consumerName: string;
  messageId: string;
  payloadHash: string;
}

export abstract class WagerRepository {
  abstract submit(input: StoredWager): Promise<SubmitWagerResult>;
  abstract consume(input: StoredWager, inbox: InboxClaim): Promise<ConsumeResult>;
  abstract resumeNext(now: Date): Promise<boolean>;
}
