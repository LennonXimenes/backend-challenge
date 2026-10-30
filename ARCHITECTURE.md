# Architecture

Documento vivo. Cada decisão entra aqui no momento em que é tomada.

## Neste passo

Aplicação única em Bun 1.4 e NestJS 12, com TypeScript em `strict`. O processo sobe por `bun src/main.ts`. O runner de teste do desafio é o Bun; Jest fica de fora.

Três pastas separam o código:

- `src/domain` — invariantes, sem Nest e sem ORM
- `src/application` — casos de uso
- `src/infra` — banco, fila e HTTP

Compose local sobe PostgreSQL 16 e LocalStack só com SQS. A aplicação fala com o PostgreSQL. O SQS ainda não está ligado.

## ORM e schema

MikroORM 7 persiste wallet, transação e ledger por entity. O `EntityManager` da transação é a unit of work e guarda a wallet no identity map. O saldo entra e sai como string. `NumericStringType` mapeia `numeric(19, 2)` e recusa um valor que chegue como `number`.

A migration roda por `bun run migration:up` e `bun run migration:down`. O schema continua SQL explícito. `snapshot` fica desligado para o ORM não gerar uma migration a partir das entities.

Dinheiro no domínio é a classe `Money`, imutável, com `decimal.js`. A entrada é string. Mais de duas casas é erro, sem arredondamento. `number`, `float` e `double` não entram no contrato. A classe não importa Nest nem MikroORM. O valor que cabe no banco tem no máximo 17 dígitos antes da vírgula, o limite de `numeric(19, 2)`.

Dinheiro persiste em `numeric(19, 2)`. Não há coluna `float` nem `double precision`. O saldo da wallet tem `check (balance >= 0)`. O lançamento do ledger confere a aritmética no banco (`balance_before ± amount = balance_after`) e um trigger recusa `update` e `delete`.

Unicidade já coberta: uma wallet por jogador e moeda, uma transação por provedor e id externo, uma idempotency key, um lançamento por wallet e transação, e uma reversão viva (`PENDING`, `PENDING_REFERENCE` ou `PROCESSED`) por referência e tipo.

A outbox grava o envelope do evento em `jsonb`. O valor monetário dentro de `data` é `MoneyProps` (string), nunca a classe `Money`. Inbox ainda não tem tabela.

## Abertura da wallet

`POST /wallets` e `GET /wallets/:id`. Saldo inicial zero não gera lançamento. Saldo maior que zero gera uma `OPENING` interna, já `PROCESSED`, com um `CREDIT` de `0.00` até o saldo inicial. `version` nasce em 1. A mesma carteira por jogador e moeda responde `409`. Payload inválido responde `400`. Carteira ausente responde `404`.

`OPENING` não tem campo na API. O provedor gravado é `internal`, a rodada e o jogo são `opening`, e a idempotency key é `internal:opening:{walletId}`. O `payloadHash` é SHA-256 do JSON canônico (chaves ordenadas em todos os níveis) dos campos de negócio. A abertura e a aposta usam o mesmo algoritmo. O hash da aposta cobre `externalTransactionId`, `gameId`, `kind`, `money`, `playerId`, `providerId`, `referenceExternalTransactionId`, `roundId` e `walletId`. Campo ausente não entra no JSON.

## Aposta e ganho

`POST /wagering/transactions` aceita `BET` e `WIN`. O header `Idempotency-Key` é obrigatório. O servidor não inventa a key. Os testes enviam `{providerId}:{externalTransactionId}`.

Dentro de `em.transactional()`, a wallet é lida com `LockMode.PESSIMISTIC_WRITE`, que vira `select ... for update` daquela linha. Não há lock global. Uma transação que segura a linha de uma wallet não impede o débito de outra. A coluna `version` sobe só quando o saldo muda. Ela não é o optimistic lock do MikroORM: esse modo incrementaria a versão em qualquer flush. Duas `BET` de `80.00` sobre saldo `100.00` deixam uma `PROCESSED`, uma `REJECTED` com `INSUFFICIENT_BALANCE`, saldo `20.00` e um débito. A mesma aposta 50 vezes em paralelo deixa um débito. O mesmo resultado vale com três processos do `bun src/main.ts`, cada um com o seu `PORT` e o mesmo PostgreSQL. O replay dessas respostas não grava de novo.

`BET` debita e gera um `DEBIT`. `WIN` credita e gera um `CREDIT`. Saldo insuficiente, moeda diferente, jogador diferente ou referência inválida gravam a transação como `REJECTED`, sem lançamento e sem mexer no saldo. `WIN` com referência que ainda não existe fica `PENDING_REFERENCE`, também sem lançamento. O worker que reprocessa essa fila ainda não existe.

Cada transação grava `observed_balance` e `observed_currency`: o saldo da wallet depois da decisão. `matchesPayload` compara o hash recebido com o gravado. A mesma key e o mesmo hash devolvem essa resposta original, com `idempotentReplay: true` e o status HTTP de origem, mesmo que a wallet já tenha mudado. A mesma key com outro hash responde `409` (`transaction_conflict`) e não gera lançamento. Não é `failureCode` de negócio. Se duas requisições da mesma key passam juntas, a unique da key desfaz a segunda transação e a leitura seguinte decide entre replay e conflito. O mesmo id externo com outra key também é `409`.

HTTP deste passo: `201` processada, `202` referência pendente, `422` rejeição de negócio, `400` payload inválido, `404` wallet ausente, `409` conflito de wallet, de id externo ou de payload. O replay reutiliza o status original.

## Outbox

`WagerTransactionProcessed`, `WagerTransactionRejected`, `WalletBalanceChanged` e `WagerTransactionPendingReference` são subclasses de `IntegrationEvent`. O `eventType` e a `version` ficam na classe. `correlationId` deste passo é o id da transação. O agregado da transação é o id dela. O de `WalletBalanceChanged` é o id da wallet.

A mesma transação SQL grava a wallet, o ledger, quando existe, e a outbox. `OPENING` com saldo entra com os dois eventos. Saldo inicial zero não gera evento. `REJECTED` e `PENDING_REFERENCE` não geram `WalletBalanceChanged`. Replay não grava de novo. Nada é publicado dentro dessa transação: `published_at` nasce nulo. O publisher ainda não existe.

`scheduleRetry` espera 1s, depois 2s, 4s, com teto de 60s. O índice `outbox_messages_pending_due` deixa as pendentes com `next_attempt_at` nulo na frente. O payload não muda e a linha publicada não volta atrás. Delete é recusado.

## Ainda em aberto

`LOSS`, `REFUND`, `ROLLBACK`, o publisher da outbox e o worker de `PENDING_REFERENCE`. `WagerTransactionProcessed` ainda não cobre `LOSS`. A corrida de `REFUND` espera a operação existir.
