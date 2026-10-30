import { randomUUID } from "node:crypto";
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
  type Message,
} from "@aws-sdk/client-sqs";
import { SubmitWager } from "../../application/wagering/submit-wager";
import { writeOperationLog } from "../../application/observability/operation-log";
import { recordDlq, recordRetry, recordWager } from "../../application/observability/operation-metrics";
import { failedDelivery, visibilityDelaySeconds, WAGER_CONSUMER_NAME } from "./delivery";
import { parseSqsWagerMessage, type SqsWagerMessage } from "./parse-sqs-wager";

export class SqsWagerConsumer {
  private stopping = false;
  private abandoned = false;
  private inflight: Promise<void> | null = null;
  private receiptHandle: string | null = null;

  constructor(
    private readonly sqs: SQSClient,
    private readonly submit: SubmitWager,
    private readonly queueUrl: string,
    private readonly dlqUrl: string,
    private readonly stopGraceMs = 5_000,
  ) {}

  async run(): Promise<void> {
    while (!this.stopping) {
      const response = await this.sqs.send(new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 1,
        VisibilityTimeout: 30,
        MessageSystemAttributeNames: ["ApproximateReceiveCount"],
      }));
      const message = response.Messages?.[0];
      if (!message?.Body || !message.ReceiptHandle || this.stopping) {
        continue;
      }

      this.receiptHandle = message.ReceiptHandle;
      this.inflight = this.handle(message);
      await this.inflight;
      this.inflight = null;
      this.receiptHandle = null;
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (!this.inflight) {
      return;
    }

    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const grace = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), this.stopGraceMs);
    });
    finished = await Promise.race([
      this.inflight.then(() => true, () => true),
      grace,
    ]);
    if (timer) {
      clearTimeout(timer);
    }
    if (!finished && this.receiptHandle) {
      this.abandoned = true;
      await this.returnVisibility(this.receiptHandle);
    }
  }

  private async handle(message: Message): Promise<void> {
    const receiveCount = Number(message.Attributes?.ApproximateReceiveCount ?? "1");
    let parsed: SqsWagerMessage | undefined;
    try {
      parsed = parseSqsWagerMessage(message.Body ?? "");
      const started = Date.now();
      const result = await this.submit.executeFromInbox(parsed.command, {
        consumerName: WAGER_CONSUMER_NAME,
        messageId: parsed.messageId,
        payloadHash: parsed.payloadHash,
      });
      recordWager(result.result?.body.status ?? "", result.duplicate, Date.now() - started);
      writeOperationLog({
        level: "info",
        message: "wager consumed",
        correlationId: parsed.messageId,
        messageId: parsed.messageId,
        transactionId: result.result?.body.transactionId ?? null,
        walletId: parsed.command.walletId,
        providerId: parsed.command.providerId,
        outcome: result.duplicate ? "duplicate" : result.result?.body.status ?? null,
      });
      if (!this.abandoned) {
        await this.ack(message.ReceiptHandle ?? "");
      }
    } catch (error) {
      writeOperationLog({
        level: "error",
        message: "wager consume failed",
        correlationId: parsed?.messageId ?? null,
        messageId: parsed?.messageId ?? null,
        walletId: parsed?.command.walletId ?? null,
        providerId: parsed?.command.providerId ?? null,
        error: error instanceof Error ? error.name : "Error",
      });
      if (this.abandoned) {
        return;
      }

      if (failedDelivery(error, receiveCount) === "dlq") {
        await this.sqs.send(new SendMessageCommand({
          QueueUrl: this.dlqUrl,
          MessageBody: message.Body ?? "",
          MessageGroupId: "dlq",
          MessageDeduplicationId: `${message.MessageId ?? randomUUID()}-${randomUUID()}`,
        }));
        await this.ack(message.ReceiptHandle ?? "");
        recordDlq();
        return;
      }

      await this.sqs.send(new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: visibilityDelaySeconds(receiveCount),
      }));
      recordRetry();
    }
  }

  private ack(receiptHandle: string): Promise<unknown> {
    return this.sqs.send(new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
    }));
  }

  private returnVisibility(receiptHandle: string): Promise<unknown> {
    return this.sqs.send(new ChangeMessageVisibilityCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: 0,
    }));
  }
}
