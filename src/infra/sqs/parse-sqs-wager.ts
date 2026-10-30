import { movementPayloadHash } from "../../application/wagering/decide-movement";
import type { SubmitWagerCommand } from "../../application/wagering/submit-wager";
import { InvalidWalletInputError } from "../../domain/wallet/wallet-error";
import { parseWagerBody } from "../http/parse-wager";

export interface SqsWagerMessage {
  messageId: string;
  command: SubmitWagerCommand;
  payloadHash: string;
}

export function parseSqsWagerMessage(body: string): SqsWagerMessage {
  const parsed = JSON.parse(body) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new InvalidWalletInputError("message body is required");
  }

  const record = parsed as Record<string, unknown>;
  if (record.type !== "WagerTransactionRequested") {
    throw new InvalidWalletInputError("type must be WagerTransactionRequested");
  }

  if (typeof record.messageId !== "string" || record.messageId.trim() === "") {
    throw new InvalidWalletInputError("messageId is required");
  }

  const data = record.data;
  if (!data || typeof data !== "object") {
    throw new InvalidWalletInputError("data is required");
  }

  const idempotencyKey = (data as Record<string, unknown>).idempotencyKey;
  const command = parseWagerBody(data, typeof idempotencyKey === "string" ? idempotencyKey : undefined);
  return {
    messageId: record.messageId,
    command,
    payloadHash: movementPayloadHash(command),
  };
}
