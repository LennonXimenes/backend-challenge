import { MikroORM } from "@mikro-orm/postgresql";
import { payloadHash } from "../../domain/wager/payload-hash";
import { InboxMessage } from "../../domain/inbox/inbox-message";
import { constraintText } from "./constraint-error";
import { inboxRecordFrom, InboxRecord } from "./inbox.record";

export const INTEGRATION_EVENT_CONSUMER = "integration-events";

export class IntegrationEventConflictError extends Error {
  constructor() {
    super("integration event payload conflict");
    this.name = "IntegrationEventConflictError";
  }
}

export class SqlIntegrationEventInbox {
  constructor(private readonly orm: MikroORM) {}

  async accept(body: string, at: Date): Promise<{ duplicate: boolean }> {
    const parsed: unknown = JSON.parse(body);
    const eventId = readEventId(parsed);
    const hash = payloadHash(parsed);

    try {
      await this.orm.em.fork().transactional(async (em) => {
        const message = InboxMessage.receive({
          messageId: eventId,
          consumerName: INTEGRATION_EVENT_CONSUMER,
          payloadHash: hash,
          receivedAt: at,
        });
        message.markProcessed(at);
        em.persist(inboxRecordFrom(message));
        await em.flush();
      }, { clear: true });
      return { duplicate: false };
    } catch (error) {
      if (!constraintText(error).includes("inbox_messages_pkey")) {
        throw error;
      }

      const existing = await this.orm.em.fork().findOne(InboxRecord, {
        consumerName: INTEGRATION_EVENT_CONSUMER,
        messageId: eventId,
      });
      if (!existing || existing.payloadHash !== hash) {
        throw new IntegrationEventConflictError();
      }

      return { duplicate: true };
    }
  }
}

function readEventId(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object" || !("eventId" in parsed) || typeof parsed.eventId !== "string") {
    throw new SyntaxError("integration event id is required");
  }

  return parsed.eventId;
}
