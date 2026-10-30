import { Migration } from "@mikro-orm/migrations";

export class Migration20261029210000_ObservedBalance extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table wager_transactions
        add column observed_balance numeric(19, 2) not null default 0,
        add column observed_currency char(3) not null default 'BRL'
    `);
    this.addSql(`
      alter table wager_transactions
        alter column observed_balance drop default,
        alter column observed_currency drop default
    `);
    this.addSql(`
      alter table wager_transactions
        add constraint wager_transactions_observed_balance_non_negative check (observed_balance >= 0),
        add constraint wager_transactions_observed_currency_iso check (observed_currency ~ '^[A-Z]{3}$')
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table wager_transactions drop constraint if exists wager_transactions_observed_balance_non_negative`);
    this.addSql(`alter table wager_transactions drop constraint if exists wager_transactions_observed_currency_iso`);
    this.addSql(`alter table wager_transactions drop column if exists observed_currency`);
    this.addSql(`alter table wager_transactions drop column if exists observed_balance`);
  }
}
