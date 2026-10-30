import { CreateQueueCommand, SQSClient } from "@aws-sdk/client-sqs";

const queues = [
  "wager-transactions.fifo",
  "wager-transactions-dlq.fifo",
  "integration-events.fifo",
];

async function main(): Promise<void> {
  const client = new SQSClient({
    region: process.env.AWS_REGION ?? "us-east-1",
    endpoint: process.env.SQS_ENDPOINT ?? "http://localhost:4566",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
    },
  });

  try {
    for (const name of queues) {
      await client.send(new CreateQueueCommand({
        QueueName: name,
        Attributes: { FifoQueue: "true", ContentBasedDeduplication: "false" },
      }));
      console.log(name);
    }
  } finally {
    client.destroy();
  }
}

void main();
