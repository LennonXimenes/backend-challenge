import { randomUUID } from "node:crypto";
import { Money } from "../../domain/money/money";
import { Wallet } from "../../domain/wallet/wallet";
import { WalletRepository } from "./wallet-repository";

export class OpenWallet {
  constructor(private readonly wallets: WalletRepository) {}

  async execute(props: { playerId: string; initialBalance: Money; openedAt?: Date }): Promise<Wallet> {
    const opened = Wallet.open({
      id: randomUUID(),
      playerId: props.playerId,
      initialBalance: props.initialBalance,
      openedAt: props.openedAt ?? new Date(),
      openingTransactionId: randomUUID(),
      openingLedgerId: randomUUID(),
    });

    await this.wallets.save(opened);
    return opened.wallet;
  }
}
