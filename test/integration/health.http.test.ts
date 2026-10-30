import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CreateQueueCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Logger, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { MikroORM } from "@mikro-orm/postgresql";
import { HealthModule } from "../../src/health.module";
import { DatabaseModule } from "../../src/infra/database/database.module";
import { initOrm } from "../../src/infra/database/orm-config";

const adminUrl = "postgres://wagering:wagering@localhost:5432/postgres";
const databaseUrl = "postgres://wagering:wagering@localhost:5432/wagering_health";
const endpoint = "http://localhost:4566";

let app: NestExpressApplication;
let orm: MikroORM;
let baseUrl = "";
let queueUrl = "";

@Module({
  imports: [DatabaseModule.forRoot(databaseUrl), HealthModule],
})
class HealthHttpModule {}

beforeAll(async () => {
  Logger.overrideLogger(false);
  const admin = await initOrm(adminUrl);
  await admin.em.getConnection().execute("create database wagering_health").catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("already exists")) {
      throw error;
    }
  });
  await admin.close(true);

  orm = await initOrm(databaseUrl);
  const sqs = new SQSClient({
    region: "us-east-1",
    endpoint,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  const created = await sqs.send(new CreateQueueCommand({
    QueueName: "wager-transactions.fifo",
    Attributes: { FifoQueue: "true", ContentBasedDeduplication: "false" },
  }));
  sqs.destroy();
  if (!created.QueueUrl) {
    throw new Error("missing queue url");
  }
  queueUrl = created.QueueUrl;
  process.env.SQS_ENDPOINT = endpoint;
  process.env.AWS_REGION = "us-east-1";
  process.env.AWS_ACCESS_KEY_ID = "test";
  process.env.AWS_SECRET_ACCESS_KEY = "test";
  process.env.SQS_QUEUE_URL = queueUrl;

  app = await NestFactory.create(HealthHttpModule, { logger: false });
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
}, 40_000);

afterAll(async () => {
  delete process.env.SQS_QUEUE_URL;
  await app.close();
  await orm.close(true);
});

describe("health", () => {
  test("live answers without auth and ready checks postgres and sqs", async () => {
    const live = await fetch(`${baseUrl}/health/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: "ok" });

    const ready = await fetch(`${baseUrl}/health/ready`);
    const body = await ready.json() as { status: string; postgres: boolean; sqs: boolean };
    expect(ready.status).toBe(200);
    expect(body).toEqual({ status: "ok", postgres: true, sqs: true });
    expect(JSON.stringify(body)).not.toContain("amount");

    process.env.SQS_QUEUE_URL = `${endpoint}/000000000000/missing-health-queue.fifo`;
    const degraded = await fetch(`${baseUrl}/health/ready`);
    expect(degraded.status).toBe(503);
    expect(await degraded.json()).toEqual({ status: "unavailable", postgres: true, sqs: false });
    process.env.SQS_QUEUE_URL = queueUrl;
  }, 20_000);
});
