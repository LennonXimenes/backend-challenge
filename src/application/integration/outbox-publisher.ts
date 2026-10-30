import type { IntegrationEventSink } from "./integration-event-sink";
import type { OutboxStore } from "./outbox-store";

export class OutboxPublisher {
  constructor(
    private readonly store: OutboxStore,
    private readonly sink: IntegrationEventSink,
  ) {}

  async publishDue(now: Date): Promise<number> {
    let published = 0;

    for (;;) {
      const leased = await this.store.lease(now);
      if (!leased) {
        return published;
      }

      try {
        await this.sink.publish(leased);
        await this.store.markPublished(leased.id, now);
        published += 1;
      } catch (error: unknown) {
        const name = error instanceof Error ? error.name : "Error";
        console.error(JSON.stringify({
          level: "error",
          message: "outbox publish failed",
          error: name,
          eventId: leased.id,
        }));
      }
    }
  }
}
