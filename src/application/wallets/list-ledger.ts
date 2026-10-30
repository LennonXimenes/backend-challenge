import { InvalidWalletInputError, WalletNotFoundError } from "../../domain/wallet/wallet-error";
import type { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";
import { decodeLedgerCursor, encodeLedgerCursor } from "./ledger-cursor";
import { WalletRepository } from "./wallet-repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export interface LedgerPage {
  entries: WalletLedgerEntry[];
  nextCursor: string | null;
}

export class ListLedger {
  constructor(private readonly wallets: WalletRepository) {}

  async execute(walletId: string, cursor: string | undefined, limitText: string | undefined): Promise<LedgerPage> {
    if (!UUID_PATTERN.test(walletId)) {
      throw new InvalidWalletInputError("walletId must be a uuid");
    }

    const wallet = await this.wallets.findById(walletId);
    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    const limit = parseLimit(limitText);
    const afterId = cursor === undefined || cursor === "" ? undefined : decodeLedgerCursor(cursor);
    const rows = await this.wallets.listEntries(walletId, afterId, limit + 1);
    const entries = rows.slice(0, limit);
    const last = entries.at(-1);
    const nextCursor = rows.length > limit && last ? encodeLedgerCursor(last.id) : null;
    return { entries, nextCursor };
  }
}

function parseLimit(limitText: string | undefined): number {
  if (limitText === undefined || limitText === "") {
    return DEFAULT_LIMIT;
  }

  if (!/^[1-9]\d*$/.test(limitText)) {
    throw new InvalidWalletInputError("limit must be an integer from 1 to 100");
  }

  const limit = Number(limitText);
  if (limit > MAX_LIMIT) {
    throw new InvalidWalletInputError("limit must be an integer from 1 to 100");
  }

  return limit;
}
