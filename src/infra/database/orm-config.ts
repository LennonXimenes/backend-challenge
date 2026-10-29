import { Migrator } from "@mikro-orm/migrations";
import { defineConfig, MikroORM } from "@mikro-orm/postgresql";

const localDatabaseUrl = "postgres://wagering:wagering@localhost:5432/wagering";

export function createOrmConfig() {
  return defineConfig({
    clientUrl: process.env.DATABASE_URL ?? localDatabaseUrl,
    entities: [],
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

export function initOrm(): ReturnType<typeof MikroORM.init> {
  // The PostgreSQL init signature collapses to the base driver under strict tsc.
  return MikroORM.init(createOrmConfig() as Parameters<typeof MikroORM.init>[0]);
}
