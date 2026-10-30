import { LockMode, QueryOrder } from "@mikro-orm/core";
import { MikroORM } from "@mikro-orm/postgresql";
import { OutboxMessage } from "../../domain/integration/outbox-message";
import { type LeasedOutboxEvent, OutboxStore } from "../../application/integration/outbox-store";
import { constraintText } from "./constraint-error";
import { OutboxRecord } from "./outbox.record";

export class SqlOutboxStore extends OutboxStore {
  constructor(private readonly orm: MikroORM) {
    super();
  }

  async lease(now: Date): Promise<LeasedOutboxEvent | undefined> {
    return this.orm.em.fork().transactional(async (em) => {
      const [record] = await em.find(OutboxRecord, {
        publishedAt: null,
        $or: [
          { nextAttemptAt: null },
          { nextAttemptAt: { $lte: now } },
        ],
      }, {
        limit: 1,
        lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
        orderBy: { nextAttemptAt: QueryOrder.ASC_NULLS_FIRST, id: QueryOrder.ASC },
      });
      if (!record) {
        return undefined;
      }

      const message = OutboxMessage.rehydrate({
        id: record.id,
        aggregateId: record.aggregateId,
        eventType: record.eventType,
        payload: record.payload,
        occurredAt: record.occurredAt,
        attempts: record.attempts,
        nextAttemptAt: record.nextAttemptAt ?? undefined,
        publishedAt: record.publishedAt ?? undefined,
      });
      message.scheduleRetry(now);
      record.attempts = message.attempts;
      record.nextAttemptAt = message.nextAttemptAt ?? null;
      await em.flush();

      return {
        id: record.id,
        aggregateId: record.aggregateId,
        payload: structuredClone(record.payload),
      };
    }, { clear: true });
  }

  async markPublished(id: string, at: Date): Promise<void> {
    try {
      await this.orm.em.fork().transactional(async (em) => {
        const record = await em.findOne(OutboxRecord, { id }, {
          lockMode: LockMode.PESSIMISTIC_WRITE,
        });
        if (!record || record.publishedAt) {
          return;
        }

        const message = OutboxMessage.rehydrate({
          id: record.id,
          aggregateId: record.aggregateId,
          eventType: record.eventType,
          payload: record.payload,
          occurredAt: record.occurredAt,
          attempts: record.attempts,
          nextAttemptAt: record.nextAttemptAt ?? undefined,
        });
        message.markPublished(at);
        record.publishedAt = message.publishedAt ?? null;
        await em.flush();
      }, { clear: true });
    } catch (error) {
      if (constraintText(error).includes("already published")) {
        return;
      }

      throw error;
    }
  }
}
