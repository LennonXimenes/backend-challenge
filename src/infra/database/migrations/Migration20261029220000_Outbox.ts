import { Migration } from "@mikro-orm/migrations";

export class Migration20261029220000_Outbox extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create or replace function outbox_messages_delivery_only()
      returns trigger
      language plpgsql
      as $$
      begin
        if tg_op = 'DELETE' then
          raise exception 'outbox_messages is append-only';
        end if;

        if old.published_at is not null then
          raise exception 'outbox_messages already published';
        end if;

        if new.id is distinct from old.id
           or new.aggregate_id is distinct from old.aggregate_id
           or new.event_type is distinct from old.event_type
           or new.payload is distinct from old.payload
           or new.occurred_at is distinct from old.occurred_at
        then
          raise exception 'outbox_messages payload is immutable';
        end if;

        return new;
      end;
      $$
    `);

    this.addSql(`
      create table outbox_messages (
        id uuid primary key,
        aggregate_id uuid not null,
        event_type text not null,
        payload jsonb not null,
        occurred_at timestamptz not null,
        attempts integer not null,
        next_attempt_at timestamptz,
        published_at timestamptz,
        constraint outbox_messages_attempts_non_negative check (attempts >= 0),
        constraint outbox_messages_event_type_known check (
          event_type in (
            'WagerTransactionProcessed',
            'WagerTransactionRejected',
            'WalletBalanceChanged',
            'WagerTransactionPendingReference'
          )
        )
      )
    `);

    this.addSql(`
      create index outbox_messages_pending_due
        on outbox_messages (next_attempt_at nulls first, id)
        where published_at is null
    `);

    this.addSql(`
      create trigger outbox_messages_delivery_only
        before update or delete on outbox_messages
        for each row
        execute function outbox_messages_delivery_only()
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists outbox_messages`);
    this.addSql(`drop function if exists outbox_messages_delivery_only()`);
  }
}
