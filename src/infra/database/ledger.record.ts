import { defineEntity, p } from "@mikro-orm/core";
import { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";
import { NumericStringType } from "./numeric-string.type";

export class LedgerRecord {
  id!: string;
  walletId!: string;
  transactionId!: string;
  direction!: string;
  amount!: string;
  currency!: string;
  balanceBefore!: string;
  balanceAfter!: string;
  createdAt!: Date;
}

export const LedgerRecordSchema = defineEntity({
  class: LedgerRecord,
  tableName: "wallet_ledger_entries",
  properties: {
    id: p.uuid().primary(),
    walletId: p.uuid().fieldName("wallet_id"),
    transactionId: p.uuid().fieldName("transaction_id"),
    direction: p.string(),
    amount: p.type(NumericStringType).runtimeType("string"),
    currency: p.string().length(3).columnType("char(3)"),
    balanceBefore: p.type(NumericStringType).runtimeType("string").fieldName("balance_before"),
    balanceAfter: p.type(NumericStringType).runtimeType("string").fieldName("balance_after"),
    createdAt: p.datetime().columnType("timestamptz").fieldName("created_at"),
  },
});

export function ledgerRecordFrom(entry: WalletLedgerEntry): LedgerRecord {
  const record = new LedgerRecord();
  record.id = entry.id;
  record.walletId = entry.walletId;
  record.transactionId = entry.transactionId;
  record.direction = entry.direction;
  record.amount = entry.money.toJSON().amount;
  record.currency = entry.money.currency;
  record.balanceBefore = entry.balanceBefore.toJSON().amount;
  record.balanceAfter = entry.balanceAfter.toJSON().amount;
  record.createdAt = entry.createdAt;
  return record;
}
