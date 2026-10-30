import { InvalidWalletInputError } from "../../domain/wallet/wallet-error";
import { TransactionNotFoundError } from "../../domain/wager/wager-error";
import { WagerRepository, type WagerLookup } from "./wager-repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class GetWager {
  constructor(private readonly wagers: WagerRepository) {}

  async execute(transactionId: string): Promise<WagerLookup> {
    if (!UUID_PATTERN.test(transactionId)) {
      throw new InvalidWalletInputError("transactionId must be a uuid");
    }

    const stored = await this.wagers.findById(transactionId);
    if (!stored) {
      throw new TransactionNotFoundError(transactionId);
    }

    return stored;
  }
}
