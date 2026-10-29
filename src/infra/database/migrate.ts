import { initOrm } from "./orm-config";

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command !== "up" && command !== "down") {
    throw new Error("Use: bun src/infra/database/migrate.ts up|down");
  }

  const orm = await initOrm();

  try {
    if (command === "up") {
      await orm.migrator.up();
    } else {
      await orm.migrator.down();
    }
  } finally {
    await orm.close(true);
  }
}

void main();
