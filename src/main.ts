import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { PendingReferenceWorker } from "./application/wagering/pending-reference-worker";
import { AppModule } from "./app.module";
import { WalletExceptionFilter } from "./infra/http/wallet-exception.filter";

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
  const stop = () => clearInterval(timer);
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const port = process.env.PORT ?? "3000";
  await app.listen(port);
}

void bootstrap();
