import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { MikroORM } from "@mikro-orm/postgresql";
import { initOrm } from "../../src/infra/database/orm-config";

const walletId = "11111111-1111-4111-8111-111111111111";
const playerId = "22222222-2222-4222-8222-222222222222";
const transactionId = "33333333-3333-4333-8333-333333333333";
const ledgerId = "44444444-4444-4444-8444-444444444444";
const outboxId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const now = "2026-10-29T21:00:00.000Z";

let orm: MikroORM;

async function query<T extends Record<string, unknown>>(sql: string, params: readonly string[] = []): Promise<T[]> {
  return orm.em.getConnection().execute<T[]>(sql, [...params]);
}

describe("financial schema", () => {
  beforeAll(async () => {
    orm = await initOrm();
    await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
  });

  afterAll(async () => {
    await orm.migrator.up();
    await orm.close(true);
  });

  test("stores money as numeric with scale 2 and enforces the schema constraints", async () => {
    const columns = await query<{ data_type: string; numeric_scale: number }>(
      `select data_type, numeric_scale
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'wallets'
         and column_name = 'balance'`,
    );
    expect(columns[0]?.data_type).toBe("numeric");
    expect(Number(columns[0]?.numeric_scale)).toBe(2);

    const constraints = await query<{ conname: string }>(
      `select conname from pg_constraint where conname in (
        'wallets_player_currency_unique',
        'wallets_balance_non_negative',
        'wager_transactions_provider_external_unique',
        'wager_transactions_idempotency_key_unique',
        'wallet_ledger_entries_one_per_transaction',
        'wallet_ledger_entries_balanced',
        'wager_transactions_observed_balance_non_negative',
        'wager_transactions_observed_currency_iso',
        'outbox_messages_attempts_non_negative',
        'outbox_messages_event_type_known'
      )`,
    );
    expect(new Set(constraints.map((row) => row.conname)).size).toBe(10);

    const trigger = await query<{ tgname: string }>(
      `select tgname from pg_trigger where tgname = 'wallet_ledger_entries_no_mutation' and not tgisinternal`,
    );
    expect(trigger).toHaveLength(1);

    const outboxIndex = await query<{ indexname: string }>(
      `select indexname from pg_indexes where indexname = 'outbox_messages_pending_due'`,
    );
    expect(outboxIndex).toHaveLength(1);
  });

  test("rejects a duplicate wallet, a negative balance and a second ledger entry", async () => {
    await query(
      `insert into wallets (id, player_id, currency, balance, version, created_at, updated_at)
       values (?::uuid, ?::uuid, 'BRL', ?::numeric, 1, ?::timestamptz, ?::timestamptz)`,
      [walletId, playerId, "100.00", now, now],
    );

    await expect(
      query(
        `insert into wallets (id, player_id, currency, balance, version, created_at, updated_at)
         values (?::uuid, ?::uuid, 'BRL', ?::numeric, 1, ?::timestamptz, ?::timestamptz)`,
        ["55555555-5555-4555-8555-555555555555", playerId, "10.00", now, now],
      ),
    ).rejects.toThrow(/wallets_player_currency_unique/);

    await expect(
      query(
        `insert into wallets (id, player_id, currency, balance, version, created_at, updated_at)
         values (?::uuid, ?::uuid, 'USD', ?::numeric, 1, ?::timestamptz, ?::timestamptz)`,
        ["66666666-6666-4666-8666-666666666666", playerId, "-1.00", now, now],
      ),
    ).rejects.toThrow(/wallets_balance_non_negative/);

    await query(
      `insert into wager_transactions (
         id, provider_id, external_transaction_id, idempotency_key, payload_hash,
         wallet_id, player_id, round_id, game_id, kind, amount, currency,
         observed_balance, observed_currency, status, created_at
       ) values (
         ?::uuid, 'provider-a', 'transaction-123', 'provider-a:transaction-123', 'hash-1',
         ?::uuid, ?::uuid, 'round-1', 'fortune-chimp', 'BET', ?::numeric, 'BRL',
         ?::numeric, 'BRL', 'PROCESSED', ?::timestamptz
       )`,
      [transactionId, walletId, playerId, "80.00", "20.00", now],
    );

    await expect(
      query(
        `insert into wager_transactions (
           id, provider_id, external_transaction_id, idempotency_key, payload_hash,
           wallet_id, player_id, round_id, game_id, kind, amount, currency,
           observed_balance, observed_currency, status, created_at
         ) values (
           ?::uuid, 'provider-a', 'transaction-123', 'provider-a:other', 'hash-2',
           ?::uuid, ?::uuid, 'round-1', 'fortune-chimp', 'BET', ?::numeric, 'BRL',
           ?::numeric, 'BRL', 'PROCESSED', ?::timestamptz
         )`,
        ["77777777-7777-4777-8777-777777777777", walletId, playerId, "10.00", "100.00", now],
      ),
    ).rejects.toThrow(/wager_transactions_provider_external_unique/);

    await expect(
      query(
        `insert into wager_transactions (
           id, provider_id, external_transaction_id, idempotency_key, payload_hash,
           wallet_id, player_id, round_id, game_id, kind, amount, currency,
           observed_balance, observed_currency, status, created_at
         ) values (
           ?::uuid, 'provider-a', 'transaction-999', 'provider-a:transaction-123', 'hash-3',
           ?::uuid, ?::uuid, 'round-1', 'fortune-chimp', 'BET', ?::numeric, 'BRL',
           ?::numeric, 'BRL', 'PROCESSED', ?::timestamptz
         )`,
        ["99999999-9999-4999-8999-999999999999", walletId, playerId, "10.00", "100.00", now],
      ),
    ).rejects.toThrow(/wager_transactions_idempotency_key_unique/);

    await query(
      `insert into wallet_ledger_entries (
         id, wallet_id, transaction_id, direction, amount, currency,
         balance_before, balance_after, created_at
       ) values (
         ?::uuid, ?::uuid, ?::uuid, 'DEBIT', ?::numeric, 'BRL', ?::numeric, ?::numeric, ?::timestamptz
       )`,
      [ledgerId, walletId, transactionId, "80.00", "100.00", "20.00", now],
    );

    await expect(
      query(
        `insert into wallet_ledger_entries (
           id, wallet_id, transaction_id, direction, amount, currency,
           balance_before, balance_after, created_at
         ) values (
           ?::uuid, ?::uuid, ?::uuid, 'DEBIT', ?::numeric, 'BRL', ?::numeric, ?::numeric, ?::timestamptz
         )`,
        ["88888888-8888-4888-8888-888888888888", walletId, transactionId, "80.00", "100.00", "20.00", now],
      ),
    ).rejects.toThrow(/wallet_ledger_entries_one_per_transaction/);

    await expect(
      query(`update wallet_ledger_entries set amount = ?::numeric where id = ?::uuid`, ["1.00", ledgerId]),
    ).rejects.toThrow(/wallet_ledger_entries is immutable/);

    await expect(query(`delete from wallet_ledger_entries where id = ?::uuid`, [ledgerId])).rejects.toThrow(
      /wallet_ledger_entries is immutable/,
    );

    await query(
      `insert into outbox_messages (id, aggregate_id, event_type, payload, occurred_at, attempts)
       values (?::uuid, ?::uuid, 'WagerTransactionRejected', '{"data":{"money":{"amount":"1.00"}}}'::jsonb, ?::timestamptz, 0)`,
      [outboxId, walletId, now],
    );
    await expect(
      query(
        `update outbox_messages set payload = '{"data":{"money":{"amount":"2.00"}}}'::jsonb where id = ?::uuid`,
        [outboxId],
      ),
    ).rejects.toThrow(/outbox_messages payload is immutable/);
    await expect(query(`delete from outbox_messages where id = ?::uuid`, [outboxId])).rejects.toThrow(
      /outbox_messages is append-only/,
    );
    await expect(
      query(
        `insert into outbox_messages (id, aggregate_id, event_type, payload, occurred_at, attempts)
         values (?::uuid, ?::uuid, 'NOT_AN_EVENT', '{}'::jsonb, ?::timestamptz, 0)`,
        ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", walletId, now],
      ),
    ).rejects.toThrow(/outbox_messages_event_type_known/);
  });

  test("down drops the financial tables and up brings them back", async () => {
    await orm.migrator.down({ to: 0 });

    const gone = await query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
         and table_name in ('wallets', 'wager_transactions', 'wallet_ledger_entries', 'outbox_messages')`,
    );
    expect(gone).toHaveLength(0);

    await orm.migrator.up();

    const back = await query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
         and table_name in ('wallets', 'wager_transactions', 'wallet_ledger_entries', 'outbox_messages')`,
    );
    expect(back).toHaveLength(4);
  });
});
