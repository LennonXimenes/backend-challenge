import { defineEntity, p } from "@mikro-orm/core";
import { Money } from "../../domain/money/money";
import { WagerTransaction, WagerTransactionKind, WagerTransactionStatus } from "../../domain/wager/wager-transaction";
import { NumericStringType } from "./numeric-string.type";

export class WagerRecord {
  id!: string;
  providerId!: string;
  externalTransactionId!: string;
  idempotencyKey!: string;
  payloadHash!: string;
  walletId!: string;
  playerId!: string;
  roundId!: string;
  gameId!: string;
  kind!: string;
  amount!: string;
  currency!: string;
  referenceExternalTransactionId!: string | null;
  status!: string;
  referenceTransactionId!: string | null;
  failureCode!: string | null;
  createdAt!: Date;
  processedAt!: Date | null;
  observedBalance!: string;
  observedCurrency!: string;
}

export const WagerRecordSchema = defineEntity({
  class: WagerRecord,
  tableName: "wager_transactions",
  properties: {
    id: p.uuid().primary(),
    providerId: p.string().fieldName("provider_id"),
    externalTransactionId: p.string().fieldName("external_transaction_id"),
    idempotencyKey: p.string().fieldName("idempotency_key"),
    payloadHash: p.string().fieldName("payload_hash"),
    walletId: p.uuid().fieldName("wallet_id"),
    playerId: p.uuid().fieldName("player_id"),
    roundId: p.string().fieldName("round_id"),
    gameId: p.string().fieldName("game_id"),
    kind: p.string(),
    amount: p.type(NumericStringType).runtimeType("string"),
    currency: p.string().length(3).columnType("char(3)"),
    referenceExternalTransactionId: p.string().nullable().fieldName("reference_external_transaction_id"),
    status: p.string(),
    referenceTransactionId: p.uuid().nullable().fieldName("reference_transaction_id"),
    failureCode: p.string().nullable().fieldName("failure_code"),
    createdAt: p.datetime().columnType("timestamptz").fieldName("created_at"),
    processedAt: p.datetime().nullable().columnType("timestamptz").fieldName("processed_at"),
    observedBalance: p.type(NumericStringType).runtimeType("string").fieldName("observed_balance"),
    observedCurrency: p.string().length(3).columnType("char(3)").fieldName("observed_currency"),
  },
});

export function wagerRecordFrom(
  transaction: WagerTransaction,
  observed: { amount: string; currency: string },
): WagerRecord {
  const record = new WagerRecord();
  record.id = transaction.id;
  record.providerId = transaction.providerId;
  record.externalTransactionId = transaction.externalTransactionId;
  record.idempotencyKey = transaction.idempotencyKey;
  record.payloadHash = transaction.payloadHash;
  record.walletId = transaction.walletId;
  record.playerId = transaction.playerId;
  record.roundId = transaction.roundId;
  record.gameId = transaction.gameId;
  record.kind = transaction.kind;
  record.amount = transaction.money.toJSON().amount;
  record.currency = transaction.money.currency;
  record.referenceExternalTransactionId = transaction.referenceExternalTransactionId ?? null;
  record.status = transaction.status;
  record.referenceTransactionId = transaction.referenceTransactionId ?? null;
  record.failureCode = transaction.failureCode ?? null;
  record.createdAt = transaction.createdAt;
  record.processedAt = transaction.processedAt ?? null;
  record.observedBalance = observed.amount;
  record.observedCurrency = observed.currency;
  return record;
}

export function transactionFromRecord(record: WagerRecord): WagerTransaction {
  const currency = record.currency.trim();
  return WagerTransaction.rehydrate({
    id: record.id,
    providerId: record.providerId,
    externalTransactionId: record.externalTransactionId,
    idempotencyKey: record.idempotencyKey,
    payloadHash: record.payloadHash,
    walletId: record.walletId,
    playerId: record.playerId,
    roundId: record.roundId,
    gameId: record.gameId,
    kind: record.kind as WagerTransactionKind,
    money: Money.from({ amount: record.amount, currency }),
    referenceExternalTransactionId: record.referenceExternalTransactionId ?? undefined,
    createdAt: new Date(record.createdAt),
    status: record.status as WagerTransactionStatus,
    failureCode: record.failureCode ?? undefined,
    processedAt: record.processedAt ? new Date(record.processedAt) : undefined,
    referenceTransactionId: record.referenceTransactionId ?? undefined,
  });
}
