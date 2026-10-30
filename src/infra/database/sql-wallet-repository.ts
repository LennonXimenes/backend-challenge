import { randomUUID } from "node:crypto";
import { MikroORM } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";
import { outboxForTransaction } from "../../application/integration/outbox-for-transaction";
import { WalletRepository } from "../../application/wallets/wallet-repository";
import { OpenedWallet, Wallet } from "../../domain/wallet/wallet";
import { WalletAlreadyExistsError } from "../../domain/wallet/wallet-error";
import { constraintText } from "./constraint-error";
import { ledgerRecordFrom } from "./ledger.record";
import { persistOutbox } from "./outbox.record";
import { wagerRecordFrom } from "./wager.record";
import { WalletRecord, walletFromRecord, walletRecordFrom } from "./wallet.record";

@Injectable()
export class SqlWalletRepository extends WalletRepository {
  constructor(private readonly orm: MikroORM) {
    super();
  }

  async save(opened: OpenedWallet): Promise<void> {
    const wallet = opened.wallet;

    try {
      await this.orm.em.fork().transactional(async (em) => {
        em.persist(walletRecordFrom(wallet));
        await em.flush();

        const opening = opened.opening;
        if (!opening) {
          return;
        }

        em.persist(wagerRecordFrom(opening.transaction, {
          amount: wallet.balance.toJSON().amount,
          currency: wallet.currency,
        }));
        await em.flush();
        em.persist(ledgerRecordFrom(opening.entry));
        persistOutbox(em, outboxForTransaction({
          transaction: opening.transaction,
          wallet,
          entry: opening.entry,
          eventId: randomUUID(),
          balanceEventId: randomUUID(),
          occurredAt: opening.transaction.processedAt ?? opening.transaction.createdAt,
        }));
        await em.flush();
      }, { clear: true });
    } catch (error) {
      if (constraintText(error).includes("wallets_player_currency_unique")) {
        throw new WalletAlreadyExistsError(wallet.playerId, wallet.currency);
      }

      throw error;
    }
  }

  async findById(walletId: string): Promise<Wallet | undefined> {
    const record = await this.orm.em.fork().findOne(WalletRecord, { id: walletId });
    if (!record) {
      return undefined;
    }

    return walletFromRecord(record);
  }
}
