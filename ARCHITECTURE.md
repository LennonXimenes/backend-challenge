# Architecture

Documento vivo. Cada decisão entra aqui no momento em que é tomada.

## Neste passo

Aplicação única em Bun 1.4 e NestJS 12, com TypeScript em `strict`. O processo sobe por `bun src/main.ts`. O runner de teste do desafio é o Bun; Jest fica de fora.

Três pastas separam o código:

- `src/domain` — invariantes, sem Nest e sem ORM
- `src/application` — casos de uso
- `src/infra` — banco, fila e HTTP

Compose local sobe PostgreSQL 16 e LocalStack só com SQS. A aplicação fala com o PostgreSQL. O consumer da fila de apostas e o publisher da outbox sobem quando as URLs das filas estão definidas.

## ORM e schema

MikroORM 7 persiste wallet, transação e ledger por entity. O `EntityManager` da transação é a unit of work e guarda a wallet no identity map. O saldo entra e sai como string. `NumericStringType` mapeia `numeric(19, 2)` e recusa um valor que chegue como `number`.

A migration roda por `bun run migration:up` e `bun run migration:down`. O schema continua SQL explícito. `snapshot` fica desligado para o ORM não gerar uma migration a partir das entities.

Dinheiro no domínio é a classe `Money`, imutável, com `decimal.js`. A entrada é string. Mais de duas casas é erro, sem arredondamento. `number`, `float` e `double` não entram no contrato. A classe não importa Nest nem MikroORM. O valor que cabe no banco tem no máximo 17 dígitos antes da vírgula, o limite de `numeric(19, 2)`.

Dinheiro persiste em `numeric(19, 2)`. Não há coluna `float` nem `double precision`. O saldo da wallet tem `check (balance >= 0)`. O lançamento do ledger confere a aritmética no banco (`balance_before ± amount = balance_after`) e um trigger recusa `update` e `delete`.

Unicidade já coberta: uma wallet por jogador e moeda, uma transação por provedor e id externo, uma idempotency key, um lançamento por wallet e transação, e uma reversão viva (`PENDING`, `PENDING_REFERENCE` ou `PROCESSED`) por referência e tipo.

A outbox grava o envelope do evento em `jsonb`. O valor monetário dentro de `data` é `MoneyProps` (string), nunca a classe `Money`. A inbox deduplica por `(consumer_name, message_id)`.

## Abertura da wallet

`POST /wallets` e `GET /wallets/:id`. Saldo inicial zero não gera lançamento. Saldo maior que zero gera uma `OPENING` interna, já `PROCESSED`, com um `CREDIT` de `0.00` até o saldo inicial. `version` nasce em 1. A mesma carteira por jogador e moeda responde `409`. Payload inválido responde `400`. Carteira ausente responde `404`.

`OPENING` não tem campo na API. O provedor gravado é `internal`, a rodada e o jogo são `opening`, e a idempotency key é `internal:opening:{walletId}`. O `payloadHash` é SHA-256 do JSON canônico (chaves ordenadas em todos os níveis) dos campos de negócio. A abertura e a aposta usam o mesmo algoritmo. O hash da aposta cobre `externalTransactionId`, `gameId`, `kind`, `money`, `playerId`, `providerId`, `referenceExternalTransactionId`, `roundId` e `walletId`. Campo ausente não entra no JSON.

## Aposta e ganho

`POST /wagering/transactions` aceita `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`. `LOSS` fica `PROCESSED`, grava `WagerTransactionProcessed` e não gera `WalletBalanceChanged`. O saldo e a `version` ficam parados. Se a `LOSS` cita uma aposta que ainda não existe, fica `PENDING_REFERENCE`, também sem lançamento. `REFUND` exige `referenceExternalTransactionId`; sem o campo a resposta é `400`. A referência é a `BET` `PROCESSED` do mesmo provedor, jogador, wallet, moeda e rodada, resolvida por `(providerId, referenceExternalTransactionId)`. O valor tem de ser igual. O crédito é um `CREDIT`. Uma segunda reversão da mesma aposta fica `REJECTED` com `ALREADY_REVERSED`. Valor diferente fica `AMOUNT_MISMATCH`. Referência ainda ausente fica `PENDING_REFERENCE`, sem crédito. Se já existe reversão ativa daquele tipo para a mesma referência, a nova fica `ALREADY_REVERSED`, mesmo com a referência ausente. O índice `wager_transactions_one_reversal_per_reference` impede duas reversões ativas. Duas `REFUND` da mesma aposta em paralelo deixam um crédito. `REFUND` credita, então não produz saldo negativo. `ROLLBACK` também exige a referência: sem o campo a resposta é `400`, e referência ausente fica `PENDING_REFERENCE`. A referência `PROCESSED` tem de ser `BET`, `WIN` ou `REFUND`, no mesmo provedor, jogador, wallet, moeda e rodada, com o mesmo valor. O efeito é o inverso: `BET` gera `CREDIT`; `WIN` e `REFUND` geram `DEBIT`. `LOSS` não é referência válida. O índice único é por tipo, então `REFUND` e `ROLLBACK` da mesma aposta são reversões diferentes e as duas podem creditar. A segunda do mesmo tipo fica `ALREADY_REVERSED`. Se o débito da reversão deixaria o saldo negativo, a transação fica `REJECTED` com `REVERSAL_EXCEEDS_BALANCE`, sem lançamento. Esse código não é o `INSUFFICIENT_BALANCE` da aposta. O header `Idempotency-Key` é obrigatório. O servidor não inventa a key. Os testes enviam `{providerId}:{externalTransactionId}`.

Dentro de `em.transactional()`, a wallet é lida com `LockMode.PESSIMISTIC_WRITE`, que vira `select ... for update` daquela linha. Não há lock global. Uma transação que segura a linha de uma wallet não impede o débito de outra. A coluna `version` sobe só quando o saldo muda. Ela não é o optimistic lock do MikroORM: esse modo incrementaria a versão em qualquer flush. Duas `BET` de `80.00` sobre saldo `100.00` deixam uma `PROCESSED`, uma `REJECTED` com `INSUFFICIENT_BALANCE`, saldo `20.00` e um débito. A mesma aposta 50 vezes em paralelo deixa um débito. O mesmo resultado vale com três processos do `bun src/main.ts`, cada um com o seu `PORT` e o mesmo PostgreSQL. O replay dessas respostas não grava de novo.

`BET` debita e gera um `DEBIT`. `WIN` credita e gera um `CREDIT`. Saldo insuficiente, moeda diferente, jogador diferente ou referência inválida gravam a transação como `REJECTED`, sem lançamento e sem mexer no saldo. `WIN` com referência que ainda não existe fica `PENDING_REFERENCE`, também sem lançamento. O worker de `PENDING_REFERENCE` roda a cada 1s no processo. A primeira espera é de 1s, depois 2s, 4s, 8s e 16s. Na quinta tentativa sem a referência, a transação fica `REJECTED` com `REFERENCE_NOT_FOUND` e grava `WagerTransactionRejected`. Fora de ordem costuma durar segundos; 31s cobre essa reordenação e uma indisponibilidade curta. O agendamento fica em `reference_attempts` e `reference_next_attempt_at`. O claim usa `for update skip locked` da linha pendente e, em seguida, o lock da wallet. Duas instâncias não pegam a mesma linha. Enquanto espera, o replay continua `202`. Quando resolve, o replay devolve o resultado final e o saldo daquele momento.

Cada transação grava `observed_balance` e `observed_currency`: o saldo da wallet depois da decisão. `matchesPayload` compara o hash recebido com o gravado. A mesma key e o mesmo hash devolvem essa resposta original, com `idempotentReplay: true` e o status HTTP de origem, mesmo que a wallet já tenha mudado. A mesma key com outro hash responde `409` (`transaction_conflict`) e não gera lançamento. Não é `failureCode` de negócio. Se duas requisições da mesma key passam juntas, a unique da key desfaz a segunda transação e a leitura seguinte decide entre replay e conflito. O mesmo id externo com outra key também é `409`.

HTTP deste passo: `201` processada, `202` referência pendente, `422` rejeição de negócio, `400` payload inválido, `404` wallet ausente, `409` conflito de wallet, de id externo ou de payload. O replay reutiliza o status original.

## Outbox

`WagerTransactionProcessed`, `WagerTransactionRejected`, `WalletBalanceChanged` e `WagerTransactionPendingReference` são subclasses de `IntegrationEvent`. O `eventType` e a `version` ficam na classe. `correlationId` deste passo é o id da transação. O agregado da transação é o id dela. O de `WalletBalanceChanged` é o id da wallet.

A mesma transação SQL grava a wallet, o ledger, quando existe, e a outbox. `OPENING` com saldo entra com os dois eventos. Saldo inicial zero não gera evento. `REJECTED` e `PENDING_REFERENCE` não geram `WalletBalanceChanged`. Replay não grava de novo. Nada é publicado dentro dessa transação: `published_at` nasce nulo. Uma linha ainda não commitada não aparece para o publisher.

O publisher lê a outbox já commitada. O claim é `for update skip locked` de uma pendente com `next_attempt_at` nulo ou vencido. Esse claim chama `scheduleRetry` e confirma a reserva antes de falar com o SQS: 1s, depois 2s, 4s, teto de 60s. Se o processo morre antes do envio, ou depois do envio e antes de gravar `published_at`, outra instância pega a linha quando a reserva vence. A fila é `integration-events.fifo`. O `MessageDeduplicationId` muda a cada envio, então o FIFO não esconde a republicação. O corpo leva o mesmo `eventId`. O consumidor `integration-events` grava a inbox por esse id: a segunda cópia não cria outra linha. Uma linha com `published_at` preenchido não volta para a fila. O payload não muda e delete continua recusado.

## Logs

Cada linha é um JSON. Os campos `correlationId`, `messageId`, `transactionId`, `walletId` e `providerId` entram sempre; o que não existe fica `null`. Na HTTP, `correlationId` vem do header `x-correlation-id` e, sem ele, do id da transação ou da wallet. Na fila, é o `messageId`. O texto da exceção não entra: só o nome do erro. Valor, saldo e corpo do pedido não têm campo. Um id numérico é descartado.

Os contadores do processo cobrem transações por status, duplicatas, retries, DLQ, conflitos de lock, atraso da outbox e latência. A latência e o atraso são milissegundos inteiros. Duplicata não conta de novo como transação. Esses números não são a idempotência: ela continua no banco.

`GET /health/live` responde `200` sem autenticação, só para dizer que o processo atende. `GET /health/ready` exige o Postgres (`select 1`) e a fila configurada em `SQS_QUEUE_URL`. Os dois precisam responder. Se um falha, a resposta é `503` com `postgres` e `sqs` em booleano, sem URL e sem saldo.

## Decisões e limites

O ORM é o MikroORM, com unit of work e identity map. O schema continua SQL explícito e o `snapshot` fica desligado, para o ORM não gerar migration sozinho. Prisma fica de fora.

`Money` é string decimal com escala 2. Mais de duas casas é erro, sem arredondar. O banco guarda `numeric(19, 2)`. O modelo aceita várias moedas; a operação deste desafio usa `BRL`.

O lock é pessimista na linha da wallet, não global. A `version` sobe só quando o saldo muda. Ela não é o optimistic lock do ORM.

O `payloadHash` é SHA-256 do JSON canônico, só com campos de negócio. A mesma key com outro hash é `409`. A idempotência fica na unique do Postgres.

`PENDING_REFERENCE` tenta cinco vezes: 1s, 2s, 4s, 8s e 16s. Depois disso, `REFERENCE_NOT_FOUND`.

HTTP: `201` processada, `202` pendente, `422` rejeição, `400` payload, `404` ausente, `409` conflito, `503` falha transitória. Erro de programa fica `500`. O mesmo mapa vale para todos os endpoints. Health não pede autenticação.

`GET /wallets/:walletId/ledger` lê o ledger em ordem de `created_at` e, no empate, `id`. O cursor é o id do último lançamento da página, em base64url. A página seguinte traz só linhas da mesma wallet com `(created_at, id)` maior que essa. O mesmo cursor devolve a mesma página; um lançamento novo aparece depois dela. O limite padrão é 50 e o teto é 100. Cursor ou limite inválido responde `400`. Wallet ausente responde `404`. Valor e saldo saem como string decimal. A rota só lê.

`GET /wagering/transactions/:transactionId` lê a linha já gravada. O `balance` da resposta é o `observed_balance` daquela transação, não o saldo atual da wallet. Valor e saldo saem como string decimal. Id que não é uuid responde `400`. Transação ausente responde `404` com `transaction_not_found`.

`GET /providers/:providerId/wagering/transactions/:externalTransactionId` resolve a unique `(provider_id, external_transaction_id)`. O mesmo id externo em outro provedor é outra transação. A resposta é a mesma da consulta por id, com o saldo daquele momento. Provider ou id externo em branco responde `400`. Ausente responde `404` com `transaction_not_found`.

`POST /wallets/:walletId/reconciliation` compara o saldo gravado com a soma do ledger. `difference` é saldo gravado menos soma calculada. Os dois iguais deixam `consistent: true` e `difference` `0.00`. Divergência responde `200` com `consistent: false`, grava a métrica `reconciliationDivergences` e um log sem valor nem saldo. A wallet não é alterada. Wallet ausente responde `404`. Id inválido responde `400`.

Auth não entra nesta entrega. Não há tabela de usuário nem hash de senha. O desenho adiado é um IdP externo, Keycloak, na frente de `POST /wallets` e `POST /wagering/transactions`. O ponto de extensão é `ProviderIdentityPort`: `UnconfiguredIdentity` recusa o token até o IdP existir, e `OpenAccessGuard` hoje libera o acesso. Esse guard não está registrado. `GET /health/live` e `GET /health/ready` continuam abertos. A fila é canal interno. O `providerId` e o `playerId` da mensagem passam pela mesma regra do domínio: jogador diferente da wallet fica `REJECTED` com `PLAYER_MISMATCH`, sem lançamento.

Limites conhecidos: as métricas morrem com o processo e não se somam entre instâncias. A corrida do saldo prova o Postgres; ela não atravessa a fila. OpenTelemetry, teste de carga e partidas dobradas ficam de fora.

## SQS

A fila `wager-transactions.fifo` entra pelo mesmo `SubmitWager` da HTTP. A inbox `(consumer_name, message_id)` é gravada na mesma transação do saldo, do ledger e da outbox. O `delete` da mensagem só acontece depois que essa transação confirma. A mesma mensagem, com outro id de deduplicação do FIFO, não debita de novo: a garantia é a inbox e a idempotency key. Rejeição de negócio dá ack. Payload inválido, wallet ausente ou conflito de payload vão para `wager-transactions-dlq.fifo`. Erro transitório devolve a mensagem com espera de 1s, 2s, 4s, e na quinta tentativa vai para a DLQ. `SIGTERM` espera o processamento em voo; se ele não termina a tempo, a visibilidade volta a zero.
