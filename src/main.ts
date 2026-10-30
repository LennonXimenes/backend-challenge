import "reflect-metadata";
import { SQSClient } from "@aws-sdk/client-sqs";
import { NestFactory } from "@nestjs/core";
import { PendingReferenceWorker } from "./application/wagering/pending-reference-worker";
import { SubmitWager } from "./application/wagering/submit-wager";
import { AppModule } from "./app.module";
import { WalletExceptionFilter } from "./infra/http/wallet-exception.filter";
import { SqsWagerConsumer } from "./infra/sqs/sqs-consumer";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new WalletExceptionFilter());
  const worker = app.get(PendingReferenceWorker);
  const timer = setInterval(() => {
    void worker.run(new Date()).catch((error: unknown) => {
      const name = error instanceof Error ? error.name : "Error";
      console.error(JSON.stringify({ level: "error", message: "pending reference worker failed", error: name }));
    });
  }, 1_000);
  const queueUrl = process.env.SQS_QUEUE_URL;
  const dlqUrl = process.env.SQS_DLQ_URL;
  const consumer = queueUrl && dlqUrl
    ? new SqsWagerConsumer(
      new SQSClient({
        region: process.env.AWS_REGION ?? "us-east-1",
        endpoint: process.env.SQS_ENDPOINT,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
        },
      }),
      app.get(SubmitWager),
      queueUrl,
      dlqUrl,
    )
    : undefined;
  const polling = consumer?.run().catch((error: unknown) => {
    const name = error instanceof Error ? error.name : "Error";
    console.error(JSON.stringify({ level: "error", message: "sqs consumer failed", error: name }));
  });
  const stop = () => {
    clearInterval(timer);
    void consumer?.stop();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  void polling;
  const port = process.env.PORT ?? "3000";
  await app.listen(port);
}

void bootstrap();
