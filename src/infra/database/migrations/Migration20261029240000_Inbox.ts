import { Migration } from "@mikro-orm/migrations";

export class Migration20261029240000_Inbox extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table inbox_messages (
        consumer_name text not null,
        message_id text not null,
        payload_hash text not null,
        received_at timestamptz not null,
        processed_at timestamptz,
        constraint inbox_messages_pkey primary key (consumer_name, message_id)
      )
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists inbox_messages`);
  }
}
