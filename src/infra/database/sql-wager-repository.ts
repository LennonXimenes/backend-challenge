import { randomUUID } from "node:crypto";
import { LockMode } from "@mikro-orm/core";
import { MikroORM, type EntityManager } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";
import { outboxForTransaction } from "../../application/integration/outbox-for-transaction";
import { decideMovement, movementPayloadHash, type ResolvedReference } from "../../application/wagering/decide-movement";
import { httpStatusFor, type SubmitWagerResult } from "../../application/wagering/submit-wager";
import { type StoredWager, WagerRepository } from "../../application/wagering/wager-repository";
import { Wallet } from "../../domain/wallet/wallet";
import { WalletNotFoundError } from "../../domain/wallet/wallet-error";
import { WagerConflictError } from "../../domain/wager/wager-error";
import { WagerTransaction } from "../../domain/wager/wager-transaction";
import { constraintText } from "./constraint-error";
import { ledgerRecordFrom } from "./ledger.record";
import { normalizeAmount } from "./numeric-string.type";
import { persistOutbox } from "./outbox.record";
import { WagerRecord, transactionFromRecord, wagerRecordFrom } from "./wager.record";
import { WalletRecord, walletFromRecord } from "./wallet.record";

@Injectable()
export class SqlWagerRepository extends WagerRepository {
  constructor(private readonly orm: MikroORM) {
    super();
  }

  async submit(input: StoredWager): Promise<SubmitWagerResult> {
    const hash = movementPayloadHash(input);

    try {
      return await this.orm.em.fork().transactional(async (em) => {
        const already = await findByKey(em, input.idempotencyKey);
        if (already) {
          return replay(already, hash);
        }

        const walletRecord = await em.findOne(WalletRecord, { id: input.walletId }, {
          lockMode: LockMode.PESSIMISTIC_WRITE,
        });
        if (!walletRecord) {
          throw new WalletNotFoundError(input.walletId);
        }

        const raced = await findByKey(em, input.idempotencyKey);
        if (raced) {
          return replay(raced, hash);
        }

        const reference = input.referenceExternalTransactionId
          ? await findReference(em, input.providerId, input.referenceExternalTransactionId)
          : undefined;
        const wallet = walletFromRecord(walletRecord);
        const decision = decideMovement(wallet, { ...input, reference });
        const observed = { amount: wallet.balance.toJSON().amount, currency: wallet.currency };

        em.persist(wagerRecordFrom(decision.transaction, observed));
        await em.flush();

        if (decision.entry) {
          applyBalance(walletRecord, wallet);
          em.persist(ledgerRecordFrom(decision.entry));
        }
        persistOutbox(em, outboxForTransaction({
          transaction: decision.transaction,
          wallet,
          entry: decision.entry,
          eventId: randomUUID(),
          balanceEventId: decision.entry ? randomUUID() : undefined,
          occurredAt: decision.transaction.processedAt ?? decision.transaction.createdAt,
        }));
        await em.flush();

        return resultFrom(decision.transaction, observed, false);
      }, { clear: true });
    } catch (error) {
      if (error instanceof WagerConflictError || error instanceof WalletNotFoundError) {
        throw error;
      }

      const text = constraintText(error);
      if (text.includes("wager_transactions_idempotency_key_unique")) {
        return this.replayCommitted(hash, input.idempotencyKey);
      }

      if (text.includes("wager_transactions_provider_external_unique")) {
        throw new WagerConflictError();
      }

      throw error;
    }
  }

  private async replayCommitted(hash: string, idempotencyKey: string): Promise<SubmitWagerResult> {
    const existing = await this.orm.em.fork().findOne(WagerRecord, { idempotencyKey });
    if (!existing) {
      throw new WagerConflictError();
    }

    return replay(existing, hash);
  }
}

function applyBalance(record: WalletRecord, wallet: Wallet): void {
  record.balance = wallet.balance.toJSON().amount;
  record.version = wallet.version;
  record.updatedAt = wallet.updatedAt;
}

async function findByKey(em: EntityManager, idempotencyKey: string): Promise<WagerRecord | null> {
  return em.findOne(WagerRecord, { idempotencyKey });
}

async function findReference(
  em: EntityManager,
  providerId: string,
  externalTransactionId: string,
): Promise<ResolvedReference | undefined> {
  const record = await em.findOne(WagerRecord, { providerId, externalTransactionId });
  if (!record) {
    return undefined;
  }

  return {
    id: record.id,
    kind: record.kind,
    status: record.status,
    playerId: record.playerId,
    walletId: record.walletId,
    roundId: record.roundId,
    currency: record.currency.trim(),
  };
}

function replay(record: WagerRecord, hash: string): SubmitWagerResult {
  const transaction = transactionFromRecord(record);
  if (!transaction.matchesPayload(hash)) {
    throw new WagerConflictError();
  }

  return resultFrom(transaction, {
    amount: record.observedBalance,
    currency: record.observedCurrency.trim(),
  }, true);
}

function resultFrom(
  transaction: WagerTransaction,
  observed: { amount: string; currency: string },
  idempotentReplay: boolean,
): SubmitWagerResult {
  const body: SubmitWagerResult["body"] = {
    transactionId: transaction.id,
    status: transaction.status,
    balance: { amount: normalizeAmount(observed.amount), currency: observed.currency.trim() },
    idempotentReplay,
  };
  if (transaction.failureCode) {
    body.failureCode = transaction.failureCode;
  }

  return { httpStatus: httpStatusFor(transaction.status), body };
}
