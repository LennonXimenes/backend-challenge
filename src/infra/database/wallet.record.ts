import { defineEntity, p } from "@mikro-orm/core";
import { Money } from "../../domain/money/money";
import { Wallet } from "../../domain/wallet/wallet";
import { NumericStringType } from "./numeric-string.type";

export class WalletRecord {
  id!: string;
  playerId!: string;
  currency!: string;
  balance!: string;
  version!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

export const WalletRecordSchema = defineEntity({
  class: WalletRecord,
  tableName: "wallets",
  properties: {
    id: p.uuid().primary(),
    playerId: p.uuid().fieldName("player_id"),
    currency: p.string().length(3).columnType("char(3)"),
    balance: p.type(NumericStringType).runtimeType("string"),
    version: p.integer(),
    createdAt: p.datetime().columnType("timestamptz").fieldName("created_at"),
    updatedAt: p.datetime().columnType("timestamptz").fieldName("updated_at"),
  },
});

export function walletRecordFrom(wallet: Wallet): WalletRecord {
  const record = new WalletRecord();
  record.id = wallet.id;
  record.playerId = wallet.playerId;
  record.currency = wallet.currency;
  record.balance = wallet.balance.toJSON().amount;
  record.version = wallet.version;
  record.createdAt = wallet.createdAt;
  record.updatedAt = wallet.updatedAt;
  return record;
}

export function walletFromRecord(record: WalletRecord): Wallet {
  const currency = record.currency.trim();
  return Wallet.rehydrate({
    id: record.id,
    playerId: record.playerId,
    currency,
    balance: Money.from({ amount: record.balance, currency }),
    version: Number(record.version),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  });
}
