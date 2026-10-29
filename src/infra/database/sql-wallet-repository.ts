import { UniqueConstraintViolationException } from "@mikro-orm/core";
import { MikroORM } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";
import { WalletRepository } from "../../application/wallets/wallet-repository";
import { Money } from "../../domain/money/money";
import { OpenedWallet, Wallet } from "../../domain/wallet/wallet";
import { WalletAlreadyExistsError } from "../../domain/wallet/wallet-error";
import { OPENING_GAME_ID, OPENING_PROVIDER_ID, OPENING_ROUND_ID } from "../../domain/wager/wager-transaction";

@Injectable()
export class SqlWalletRepository extends WalletRepository {
  constructor(private readonly orm: MikroORM) {
    super();
  }

  async save(opened: OpenedWallet): Promise<void> {
    const wallet = opened.wallet;

    try {
      await this.orm.em.fork().transactional(async (em) => {
        const ctx = em.getTransactionContext();
        const connection = em.getConnection();
        await connection.execute(
          `insert into wallets (id, player_id, currency, balance, version, created_at, updated_at)
           values (?::uuid, ?::uuid, ?, ?::numeric, ?, ?::timestamptz, ?::timestamptz)`,
          [
            wallet.id,
            wallet.playerId,
            wallet.currency,
            wallet.balance.toJSON().amount,
            wallet.version,
            wallet.createdAt.toISOString(),
            wallet.updatedAt.toISOString(),
          ],
          "run",
          ctx,
        );

        const opening = opened.opening;
        if (!opening) {
          return;
        }

        const transaction = opening.transaction;
        const entry = opening.entry;
        await connection.execute(
          `insert into wager_transactions (
             id, provider_id, external_transaction_id, idempotency_key, payload_hash,
             wallet_id, player_id, round_id, game_id, kind, amount, currency, status, created_at, processed_at
           ) values (
             ?::uuid, ?, ?, ?, ?,
             ?::uuid, ?::uuid, ?, ?, ?, ?::numeric, ?, ?, ?::timestamptz, ?::timestamptz
           )`,
          [
            transaction.id,
            OPENING_PROVIDER_ID,
            transaction.externalTransactionId,
            transaction.idempotencyKey,
            transaction.payloadHash,
            transaction.walletId,
            transaction.playerId,
            OPENING_ROUND_ID,
            OPENING_GAME_ID,
            transaction.kind,
            transaction.money.toJSON().amount,
            transaction.money.currency,
            transaction.status,
            transaction.createdAt.toISOString(),
            transaction.processedAt?.toISOString(),
          ],
          "run",
          ctx,
        );
        await connection.execute(
          `insert into wallet_ledger_entries (
             id, wallet_id, transaction_id, direction, amount, currency, balance_before, balance_after, created_at
           ) values (
             ?::uuid, ?::uuid, ?::uuid, ?, ?::numeric, ?, ?::numeric, ?::numeric, ?::timestamptz
           )`,
          [
            entry.id,
            entry.walletId,
            entry.transactionId,
            entry.direction,
            entry.money.toJSON().amount,
            entry.money.currency,
            entry.balanceBefore.toJSON().amount,
            entry.balanceAfter.toJSON().amount,
            entry.createdAt.toISOString(),
          ],
          "run",
          ctx,
        );
      }, { clear: true });
    } catch (error) {
      if (isPlayerCurrencyConflict(error)) {
        throw new WalletAlreadyExistsError(wallet.playerId, wallet.currency);
      }

      throw error;
    }
  }

  async findById(walletId: string): Promise<Wallet | undefined> {
    const rows = await this.orm.em.getConnection().execute<WalletRow[]>(
      `select id, player_id, currency, balance::text as balance, version, created_at, updated_at
       from wallets
       where id = ?::uuid`,
      [walletId],
      "all",
    );
    const row = rows[0];
    if (!row) {
      return undefined;
    }

    return Wallet.rehydrate({
      id: row.id,
      playerId: row.player_id,
      currency: row.currency.trim(),
      balance: Money.from({ amount: normalizeAmount(row.balance), currency: row.currency.trim() }),
      version: Number(row.version),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }
}

interface WalletRow {
  id: string;
  player_id: string;
  currency: string;
  balance: string;
  version: number | string;
  created_at: string | Date;
  updated_at: string | Date;
}

function normalizeAmount(amount: string): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  return `${whole}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

function isPlayerCurrencyConflict(error: unknown): boolean {
  const text = collectMessages(error);
  return text.includes("wallets_player_currency_unique");
}

function collectMessages(error: unknown): string {
  const parts: string[] = [];
  const queue: unknown[] = [error];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") {
      continue;
    }

    if (current instanceof UniqueConstraintViolationException || current instanceof Error) {
      parts.push(current.message);
    }

    if ("constraint" in current && typeof current.constraint === "string") {
      parts.push(current.constraint);
    }

    if ("cause" in current) {
      queue.push(current.cause);
    }
  }

  return parts.join(" ");
}
