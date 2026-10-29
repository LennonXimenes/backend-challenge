# Architecture

Documento vivo. Cada decisão entra aqui no momento em que é tomada.

## Neste passo

Aplicação única em Bun 1.4 e NestJS 12, com TypeScript em `strict`. O processo sobe por `bun src/main.ts`. O runner de teste do desafio é o Bun; Jest fica de fora.

Três pastas separam o código:

- `src/domain` — invariantes, sem Nest e sem ORM
- `src/application` — casos de uso
- `src/infra` — banco, fila e HTTP

Compose local sobe PostgreSQL 16 e LocalStack só com SQS. A aplicação ainda não conecta nos dois.

## ORM e schema

MikroORM 7 fala com o PostgreSQL. A migration roda por `bun run migration:up` e `bun run migration:down`. `POST /wallets` grava a wallet, e quando o saldo inicial é maior que zero também grava a transação `OPENING` e o crédito do ledger, no mesmo `em.transactional()`. O valor monetário entra no SQL como string, com cast `numeric`.

O schema deste passo é SQL explícito, não diff de entity. Ainda não há entity. `snapshot` fica desligado para o ORM não comparar um modelo vazio com o banco e gerar uma migration contrária.

Dinheiro no domínio é a classe `Money`, imutável, com `decimal.js`. A entrada é string. Mais de duas casas é erro, sem arredondamento. `number`, `float` e `double` não entram no contrato. A classe não importa Nest nem MikroORM. O valor que cabe no banco tem no máximo 17 dígitos antes da vírgula, o limite de `numeric(19, 2)`.

Dinheiro persiste em `numeric(19, 2)`. Não há coluna `float` nem `double precision`. O saldo da wallet tem `check (balance >= 0)`. O lançamento do ledger confere a aritmética no banco (`balance_before ± amount = balance_after`) e um trigger recusa `update` e `delete`.

Unicidade já coberta: uma wallet por jogador e moeda, uma transação por provedor e id externo, uma idempotency key, um lançamento por wallet e transação, e uma reversão viva (`PENDING`, `PENDING_REFERENCE` ou `PROCESSED`) por referência e tipo.

Inbox e outbox ainda não têm tabela. Entram com a mensageria.

## Abertura da wallet

`POST /wallets` e `GET /wallets/:id`. Saldo inicial zero não gera lançamento. Saldo maior que zero gera uma `OPENING` interna, já `PROCESSED`, com um `CREDIT` de `0.00` até o saldo inicial. `version` nasce em 1. A mesma carteira por jogador e moeda responde `409`. Payload inválido responde `400`. Carteira ausente responde `404`.

`OPENING` não tem campo na API. O provedor gravado é `internal`, a rodada e o jogo são `opening`, e a idempotency key é `internal:opening:{walletId}`. O `payloadHash` é SHA-256 do JSON canônico (chaves ordenadas) dos campos de negócio. Esse algoritmo vale para a abertura e será o mesmo da idempotência HTTP.

## Aposta e ganho

`POST /wagering/transactions` aceita `BET` e `WIN`. O header `Idempotency-Key` é obrigatório e gravado. O replay da mesma key ainda não está implementado: uma key repetida responde `409`.

Dentro de `em.transactional()`, a wallet é lida com `select ... for update`. O lock é da linha da wallet, não um lock global. `BET` debita e gera um `DEBIT`. `WIN` credita e gera um `CREDIT`. Os dois sobem `version`. Saldo insuficiente, moeda diferente, jogador diferente ou referência inválida gravam a transação como `REJECTED`, sem lançamento e sem mexer no saldo. `WIN` com referência que ainda não existe fica `PENDING_REFERENCE`, também sem lançamento. O worker que reprocessa essa fila ainda não existe.

HTTP deste passo: `201` processada, `202` referência pendente, `422` rejeição de negócio, `400` payload inválido, `404` wallet ausente, `409` conflito da transação.

## Ainda em aberto

Replay de idempotência, `LOSS`, `REFUND`, `ROLLBACK`, outbox e o worker de `PENDING_REFERENCE`.
