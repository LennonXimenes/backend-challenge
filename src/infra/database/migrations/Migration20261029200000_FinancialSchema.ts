import { Migration } from "@mikro-orm/migrations";

export class Migration20261029200000_FinancialSchema extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create or replace function wallet_ledger_entries_immutable()
      returns trigger
      language plpgsql
      as $$
      begin
        raise exception 'wallet_ledger_entries is immutable';
      end;
      $$
    `);

    this.addSql(`
      create table wallets (
        id uuid primary key,
        player_id uuid not null,
        currency char(3) not null,
        balance numeric(19, 2) not null,
        version integer not null,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        constraint wallets_currency_iso check (currency ~ '^[A-Z]{3}$'),
        constraint wallets_balance_non_negative check (balance >= 0),
        constraint wallets_version_starts_at_one check (version >= 1),
        constraint wallets_player_currency_unique unique (player_id, currency)
      )
    `);

    this.addSql(`
      create table wager_transactions (
        id uuid primary key,
        provider_id text not null,
        external_transaction_id text not null,
        idempotency_key text not null,
        payload_hash text not null,
        wallet_id uuid not null references wallets (id),
        player_id uuid not null,
        round_id text not null,
        game_id text not null,
        kind text not null,
        amount numeric(19, 2) not null,
        currency char(3) not null,
        reference_external_transaction_id text,
        status text not null,
        reference_transaction_id uuid,
        failure_code text,
        created_at timestamptz not null,
        processed_at timestamptz,
        constraint wager_transactions_kind_known check (
          kind in ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')
        ),
        constraint wager_transactions_status_known check (
          status in ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')
        ),
        constraint wager_transactions_amount_positive check (amount > 0),
        constraint wager_transactions_currency_iso check (currency ~ '^[A-Z]{3}$'),
        constraint wager_transactions_reference_required check (
          kind not in ('REFUND', 'ROLLBACK')
          or reference_external_transaction_id is not null
        ),
        constraint wager_transactions_provider_external_unique unique (provider_id, external_transaction_id),
        constraint wager_transactions_idempotency_key_unique unique (idempotency_key),
        constraint wager_transactions_reference_fk
          foreign key (reference_transaction_id) references wager_transactions (id)
      )
    `);

    this.addSql(`
      create unique index wager_transactions_one_reversal_per_reference
        on wager_transactions (provider_id, reference_external_transaction_id, kind)
        where kind in ('REFUND', 'ROLLBACK')
          and status in ('PENDING', 'PENDING_REFERENCE', 'PROCESSED')
    `);

    this.addSql(`
      create table wallet_ledger_entries (
        id uuid primary key,
        wallet_id uuid not null references wallets (id),
        transaction_id uuid not null references wager_transactions (id),
        direction text not null,
        amount numeric(19, 2) not null,
        currency char(3) not null,
        balance_before numeric(19, 2) not null,
        balance_after numeric(19, 2) not null,
        created_at timestamptz not null,
        constraint wallet_ledger_entries_direction_known check (direction in ('DEBIT', 'CREDIT')),
        constraint wallet_ledger_entries_amount_positive check (amount > 0),
        constraint wallet_ledger_entries_currency_iso check (currency ~ '^[A-Z]{3}$'),
        constraint wallet_ledger_entries_balances_non_negative check (
          balance_before >= 0 and balance_after >= 0
        ),
        constraint wallet_ledger_entries_balanced check (
          (direction = 'CREDIT' and balance_after = balance_before + amount)
          or
          (direction = 'DEBIT' and balance_after = balance_before - amount)
        ),
        constraint wallet_ledger_entries_one_per_transaction unique (wallet_id, transaction_id)
      )
    `);

    this.addSql(`
      create trigger wallet_ledger_entries_no_mutation
        before update or delete on wallet_ledger_entries
        for each row
        execute function wallet_ledger_entries_immutable()
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists wallet_ledger_entries`);
    this.addSql(`drop table if exists wager_transactions`);
    this.addSql(`drop table if exists wallets`);
    this.addSql(`drop function if exists wallet_ledger_entries_immutable()`);
  }
}
