import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { WalletExceptionFilter } from "./infra/http/wallet-exception.filter";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new WalletExceptionFilter());
  const port = process.env.PORT ?? "3000";
  await app.listen(port);
}

void bootstrap();
