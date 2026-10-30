import { randomUUID } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { IntegrationEventSink } from "../../application/integration/integration-event-sink";
import type { LeasedOutboxEvent } from "../../application/integration/outbox-store";

export class SqsIntegrationEventSink implements IntegrationEventSink {
  constructor(
    private readonly sqs: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async publish(event: LeasedOutboxEvent): Promise<void> {
    await this.sqs.send(new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(event.payload),
      MessageGroupId: event.aggregateId,
      MessageDeduplicationId: randomUUID(),
    }));
  }
}
