import type { OpenedWallet, Wallet } from "../../domain/wallet/wallet";
import type { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";

export abstract class WalletRepository {
  abstract save(opened: OpenedWallet): Promise<void>;
  abstract findById(walletId: string): Promise<Wallet | undefined>;
  abstract listEntries(walletId: string, afterId: string | undefined, limit: number): Promise<WalletLedgerEntry[]>;
}
