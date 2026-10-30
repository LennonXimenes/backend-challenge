import { Migrator } from "@mikro-orm/migrations";
import { defineConfig, MikroORM } from "@mikro-orm/postgresql";
import { InboxRecordSchema } from "./inbox.record";
import { LedgerRecordSchema } from "./ledger.record";
import { OutboxRecordSchema } from "./outbox.record";
import { WagerRecordSchema } from "./wager.record";
import { WalletRecordSchema } from "./wallet.record";

const localDatabaseUrl = "postgres://wagering:wagering@localhost:5432/wagering";

export function createOrmConfig(clientUrl = process.env.DATABASE_URL ?? localDatabaseUrl) {
  return defineConfig({
    clientUrl,
    entities: [WalletRecordSchema, WagerRecordSchema, LedgerRecordSchema, OutboxRecordSchema, InboxRecordSchema],
    discovery: { warnWhenNoEntities: false },
    extensions: [Migrator],
    migrations: {
      path: "./src/infra/database/migrations",
      pathTs: "./src/infra/database/migrations",
      snapshot: false,
      snapshotOnMigrate: false,
    },
  });
}

export function initOrm(clientUrl?: string): ReturnType<typeof MikroORM.init> {
  // The PostgreSQL init signature collapses to the base driver under strict tsc.
  return MikroORM.init(createOrmConfig(clientUrl) as Parameters<typeof MikroORM.init>[0]);
}
