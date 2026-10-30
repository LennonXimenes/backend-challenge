import { InvalidWalletInputError } from "../../domain/wallet/wallet-error";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeLedgerCursor(entryId: string): string {
  return Buffer.from(entryId, "utf8").toString("base64url");
}

export function decodeLedgerCursor(cursor: string): string {
  if (cursor.trim() === "" || /[^A-Za-z0-9_-]/.test(cursor)) {
    throw new InvalidWalletInputError("cursor is invalid");
  }

  const entryId = Buffer.from(cursor, "base64url").toString("utf8");
  if (!UUID_PATTERN.test(entryId) || encodeLedgerCursor(entryId) !== cursor) {
    throw new InvalidWalletInputError("cursor is invalid");
  }

  return entryId;
}
