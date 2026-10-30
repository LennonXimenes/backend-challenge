import { InvalidWalletInputError, WalletNotFoundError } from "../../domain/wallet/wallet-error";
import { Wallet } from "../../domain/wallet/wallet";
import { WalletRepository } from "./wallet-repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class GetWallet {
  constructor(private readonly wallets: WalletRepository) {}

  async execute(walletId: string): Promise<Wallet> {
    if (!UUID_PATTERN.test(walletId)) {
      throw new InvalidWalletInputError("walletId must be a uuid");
    }

    const wallet = await this.wallets.findById(walletId);
    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    return wallet;
  }
}
