import { UniqueConstraintViolationException } from "@mikro-orm/core";
import { MikroORM } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";
import { decideMovement, type ResolvedReference } from "../../application/wagering/decide-movement";
import { httpStatusFor, type SubmitWagerResult } from "../../application/wagering/submit-wager";
import { type StoredWager, WagerRepository } from "../../application/wagering/wager-repository";
import { Money } from "../../domain/money/money";
import { Wallet } from "../../domain/wallet/wallet";
import { WalletNotFoundError } from "../../domain/wallet/wallet-error";
import { WagerConflictError } from "../../domain/wager/wager-error";

@Injectable()
export class SqlWagerRepository extends WagerRepository {
  constructor(private readonly orm: MikroORM) {
    super();
  }

  async submit(input: StoredWager): Promise<SubmitWagerResult> {
    try {
      return await this.orm.em.fork().transactional(async (em) => {
        const ctx = em.getTransactionContext();
        const connection = em.getConnection();
        const locked = await connection.execute<WalletRow[]>(
          `select id, player_id, currency, balance::text as balance, version, created_at, updated_at
           from wallets
           where id = ?::uuid
           for update`,
          [input.walletId],
          "all",
          ctx,
        );
        const row = locked[0];
        if (!row) {
          throw new WalletNotFoundError(input.walletId);
        }

        const wallet = rehydrateWallet(row);
        const previousVersion = wallet.version;
        const reference = input.referenceExternalTransactionId
          ? await loadReference(connection, ctx, input.providerId, input.referenceExternalTransactionId)
          : undefined;
        const decision = decideMovement(wallet, { ...input, reference });

        await connection.execute(
          `insert into wager_transactions (
             id, provider_id, external_transaction_id, idempotency_key, payload_hash,
             wallet_id, player_id, round_id, game_id, kind, amount, currency,
             reference_external_transaction_id, reference_transaction_id, status, failure_code, created_at, processed_at
           ) values (
             ?::uuid, ?, ?, ?, ?,
             ?::uuid, ?::uuid, ?, ?, ?, ?::numeric, ?,
             ?, ?::uuid, ?, ?, ?::timestamptz, ?::timestamptz
           )`,
          [
            decision.transaction.id,
            decision.transaction.providerId,
            decision.transaction.externalTransactionId,
            decision.transaction.idempotencyKey,
            decision.transaction.payloadHash,
            decision.transaction.walletId,
            decision.transaction.playerId,
            decision.transaction.roundId,
            decision.transaction.gameId,
            decision.transaction.kind,
            decision.transaction.money.toJSON().amount,
            decision.transaction.money.currency,
            decision.transaction.referenceExternalTransactionId ?? null,
            decision.transaction.referenceTransactionId ?? null,
            decision.transaction.status,
            decision.transaction.failureCode ?? null,
            decision.transaction.createdAt.toISOString(),
            decision.transaction.processedAt?.toISOString() ?? null,
          ],
          "run",
          ctx,
        );

        const entry = decision.entry;
        if (entry) {
          const updated = await connection.execute<Array<{ id: string }>>(
            `update wallets
             set balance = ?::numeric, version = ?, updated_at = ?::timestamptz
             where id = ?::uuid and version = ?
             returning id`,
            [
              wallet.balance.toJSON().amount,
              wallet.version,
              wallet.updatedAt.toISOString(),
              wallet.id,
              previousVersion,
            ],
            "all",
            ctx,
          );
          if (updated.length === 0) {
            throw new WagerConflictError();
          }

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
        }

        const body: SubmitWagerResult["body"] = {
          transactionId: decision.transaction.id,
          status: decision.transaction.status,
          balance: wallet.balance.toJSON(),
          idempotentReplay: false,
        };
        if (decision.transaction.failureCode) {
          body.failureCode = decision.transaction.failureCode;
        }

        return { httpStatus: httpStatusFor(decision.transaction.status), body };
      }, { clear: true });
    } catch (error) {
      if (isTransactionConflict(error)) {
        throw new WagerConflictError();
      }

      throw error;
    }
  }

}

async function loadReference(
  connection: ReturnType<MikroORM["em"]["getConnection"]>,
  ctx: ReturnType<MikroORM["em"]["getTransactionContext"]>,
  providerId: string,
  externalTransactionId: string,
): Promise<ResolvedReference | undefined> {
  const rows = await connection.execute<ReferenceRow[]>(
    `select id, kind, status, player_id, wallet_id, round_id, currency
     from wager_transactions
     where provider_id = ? and external_transaction_id = ?`,
    [providerId, externalTransactionId],
    "all",
    ctx,
  );
  const row = rows[0];
  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    playerId: row.player_id,
    walletId: row.wallet_id,
    roundId: row.round_id,
    currency: row.currency.trim(),
  };
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

interface ReferenceRow {
  id: string;
  kind: string;
  status: string;
  player_id: string;
  wallet_id: string;
  round_id: string;
  currency: string;
}

function rehydrateWallet(row: WalletRow): Wallet {
  const currency = row.currency.trim();
  return Wallet.rehydrate({
    id: row.id,
    playerId: row.player_id,
    currency,
    balance: Money.from({ amount: normalizeAmount(row.balance), currency }),
    version: Number(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}

function normalizeAmount(amount: string): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  return `${whole}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

function isTransactionConflict(error: unknown): boolean {
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

  const text = parts.join(" ");
  return text.includes("wager_transactions_idempotency_key_unique") || text.includes("wager_transactions_provider_external_unique");
}
