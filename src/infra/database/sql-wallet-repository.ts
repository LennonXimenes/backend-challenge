import { QueryOrder } from "@mikro-orm/core";
import { randomUUID } from "node:crypto";
import { MikroORM } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";
import { outboxForTransaction } from "../../application/integration/outbox-for-transaction";
import { WalletRepository } from "../../application/wallets/wallet-repository";
import { Money } from "../../domain/money/money";
import { LedgerDirection } from "../../domain/wallet/ledger-direction";
import { OpenedWallet, Wallet } from "../../domain/wallet/wallet";
import { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";
import { InvalidWalletInputError, WalletAlreadyExistsError } from "../../domain/wallet/wallet-error";
import { constraintText } from "./constraint-error";
import { LedgerRecord, ledgerRecordFrom } from "./ledger.record";
import { normalizeAmount } from "./numeric-string.type";
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

  async listEntries(walletId: string, afterId: string | undefined, limit: number): Promise<WalletLedgerEntry[]> {
    const em = this.orm.em.fork();
    const after = afterId ? await em.findOne(LedgerRecord, { id: afterId, walletId }) : null;
    if (afterId && !after) {
      throw new InvalidWalletInputError("cursor is invalid");
    }

    const records = await em.find(LedgerRecord, after
      ? {
          walletId,
          $or: [
            { createdAt: { $gt: after.createdAt } },
            { createdAt: after.createdAt, id: { $gt: after.id } },
          ],
        }
      : { walletId }, {
      limit,
      orderBy: { createdAt: QueryOrder.ASC, id: QueryOrder.ASC },
    });

    return records.map((record) => WalletLedgerEntry.rehydrate({
      id: record.id,
      walletId: record.walletId,
      transactionId: record.transactionId,
      direction: record.direction === LedgerDirection.Debit ? LedgerDirection.Debit : LedgerDirection.Credit,
      money: Money.from({ amount: record.amount, currency: record.currency }),
      balanceBefore: Money.from({ amount: record.balanceBefore, currency: record.currency }),
      balanceAfter: Money.from({ amount: record.balanceAfter, currency: record.currency }),
      createdAt: record.createdAt,
    }));
  }

  async sumLedger(walletId: string): Promise<{ amount: string; entries: number }> {
    const rows = await this.orm.em.getConnection().execute<Array<{ calculated: string; entries: string }>>(
      `select coalesce(sum(case when direction = 'CREDIT' then amount else -amount end), 0)::text as calculated,
              count(*)::text as entries
       from wallet_ledger_entries
       where wallet_id = ?::uuid`,
      [walletId],
    );
    const calculated = rows[0]?.calculated ?? "0";
    const entries = rows[0]?.entries ?? "0";
    if (!/^\d+$/.test(entries)) {
      throw new Error("ledger entry count is not an integer");
    }

    return { amount: normalizeAmount(calculated.trim()), entries: Number(entries) };
  }
}
