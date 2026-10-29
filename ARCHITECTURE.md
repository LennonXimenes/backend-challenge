# Architecture

Documento vivo. Cada decisão entra aqui no momento em que é tomada.

## Neste passo

Aplicação única em Bun 1.4 e NestJS 12, com TypeScript em `strict`. O processo sobe por `bun src/main.ts`. O runner de teste do desafio é o Bun; Jest fica de fora.

Três pastas separam o código, ainda sem regra de negócio:

- `src/domain` — invariantes, sem Nest e sem ORM
- `src/application` — casos de uso
- `src/infra` — banco, fila e HTTP

Compose local sobe PostgreSQL 16 e LocalStack só com SQS. A aplicação ainda não conecta nos dois.

## ORM e schema

MikroORM 7 fala com o PostgreSQL. A aplicação Nest ainda não abre conexão: a migration roda por `bun run migration:up` e `bun run migration:down`.

O schema deste passo é SQL explícito, não diff de entity. Ainda não há entity. `snapshot` fica desligado para o ORM não comparar um modelo vazio com o banco e gerar uma migration contrária.

Dinheiro persiste em `numeric(19, 2)`. Não há coluna `float` nem `double precision`. O saldo da wallet tem `check (balance >= 0)`. O lançamento do ledger confere a aritmética no banco (`balance_before ± amount = balance_after`) e um trigger recusa `update` e `delete`.

Unicidade já coberta: uma wallet por jogador e moeda, uma transação por provedor e id externo, uma idempotency key, um lançamento por wallet e transação, e uma reversão viva (`PENDING`, `PENDING_REFERENCE` ou `PROCESSED`) por referência e tipo.

Inbox e outbox ainda não têm tabela. Entram com a mensageria.

## Ainda em aberto

`Money` no domínio, entities do ORM, lock da wallet e o mapa de portas.
