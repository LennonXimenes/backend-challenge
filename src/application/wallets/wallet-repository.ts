import type { OpenedWallet, Wallet } from "../../domain/wallet/wallet";

export abstract class WalletRepository {
  abstract save(opened: OpenedWallet): Promise<void>;
  abstract findById(walletId: string): Promise<Wallet | undefined>;
}
