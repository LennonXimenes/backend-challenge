# Arquitetura

Um processo só. `bun src/main.ts` sobe o Nest. O consumer de `wager-transactions.fifo` e o publisher da outbox entram junto quando as URLs estão no ambiente. Os testes rodam no Bun.

PostgreSQL 16 e o LocalStack, só com SQS, sobem pelo Compose.

O código está em `src/domain`, `src/application` e `src/infra`. O domínio não importa Nest nem MikroORM. A aposta passa pelo mesmo caso de uso na HTTP e na fila. Infra é banco, SQS e controller.

## Dinheiro

`Money` é imutável e entra como string. Uso `decimal.js`. Mais de duas casas decimais é rejeição, sem arredondar. Vazio, `NaN`, infinito, notação científica e negativo na entrada também. O banco guarda `numeric(19, 2)`, com no máximo 17 dígitos antes da vírgula. `NumericStringType` recusa um valor que chegue como `number`. Não há coluna `float`.

O modelo aceita mais de uma moeda. Nesta entrega a operação é `BRL`. Moeda diferente da wallet fica `REJECTED` com `CURRENCY_MISMATCH`, sem lançamento.

## Persistência

Usei MikroORM 7 com entity. O `EntityManager` da transação é a unit of work e segura a wallet no identity map. As migrations são SQL escrito à mão (`bun run migration:up` e `migration:down`). Deixei o `snapshot` desligado para o ORM não gerar migration a partir das entities. Prisma fica de fora.

O saldo tem `check (balance >= 0)`. O lançamento confere `balance_before ± amount = balance_after`, e um trigger recusa `update` e `delete` no ledger. A outbox guarda o envelope em `jsonb`. Dentro de `data`, o dinheiro é `MoneyProps` (string), nunca a classe `Money`.

As uniques cobrem uma wallet por jogador e moeda, uma transação por provedor e id externo, uma idempotency key, um lançamento por wallet e transação, e uma reversão viva (`PENDING`, `PENDING_REFERENCE` ou `PROCESSED`) por referência e tipo. Essa última é o índice `wager_transactions_one_reversal_per_reference`. A inbox deduplica por `(consumer_name, message_id)`.

## Lock

O lock é pessimista na linha da wallet: `LockMode.PESSIMISTIC_WRITE`, um `select ... for update`. Uma aposta numa wallet não segura o débito de outra.

`version` nasce em 1 e só sobe quando o saldo muda. Deixei o optimistic lock do MikroORM de lado. Ele incrementaria a versão em qualquer flush, e `LOSS` ou rejeição não podem mexer nela.

Duas `BET` de `80.00` sobre saldo `100.00` deixam uma `PROCESSED`, uma `REJECTED` com `INSUFFICIENT_BALANCE`, saldo `20.00` e um débito. Cinquenta envios da mesma aposta deixam um débito. Três processos de `bun src/main.ts`, cada um na sua porta e no mesmo Postgres, fecham do mesmo jeito. A corrida de `80.00` também passou por dois consumers na fila. As outras ficaram na HTTP.

## Idempotência

O header `Idempotency-Key` é obrigatório. Se o cliente não manda, a API não inventa uma. Nos testes a key é `{providerId}:{externalTransactionId}`.

`payloadHash` é SHA-256 do JSON com as chaves ordenadas em todos os níveis, só com campos de negócio. Campo ausente não entra no JSON. Abertura e aposta usam o mesmo algoritmo. Na aposta entram `externalTransactionId`, `gameId`, `kind`, `money`, `playerId`, `providerId`, `referenceExternalTransactionId`, `roundId` e `walletId`.

A linha grava `observed_balance` e `observed_currency`: o saldo depois daquela decisão. A mesma key e o mesmo hash devolvem essa resposta, com `idempotentReplay: true` e o status HTTP de origem, mesmo que a wallet já tenha mudado. A mesma key com outro hash responde `409` (`transaction_conflict`), sem lançamento e sem `failureCode`. O mesmo id externo com outra key também é `409`. Se as duas requisições da mesma key entram juntas, a unique desfaz a segunda transação e a leitura seguinte separa replay de conflito.

## Abertura da wallet

`POST /wallets` com saldo zero não gera lançamento nem evento. Com saldo maior que zero, a mesma transação grava uma `OPENING` já `PROCESSED` e um `CREDIT` de `0.00` até o saldo inicial, junto com os eventos. `OPENING` não tem campo na API. O parser da fila também recusa: só entram `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`. O provedor gravado é `internal`, a rodada e o jogo são `opening`, e a key é `internal:opening:{walletId}`.

A segunda carteira do mesmo jogador e moeda responde `409`. Payload inválido responde `400`. `GET` de carteira ausente responde `404`.

## Movimento

`BET` gera um `DEBIT`. `WIN` gera um `CREDIT`. `LOSS` fica `PROCESSED`, publica `WagerTransactionProcessed` e para. Saldo e `version` ficam quietos, e não sai `WalletBalanceChanged`.

Saldo insuficiente, moeda diferente, jogador diferente ou referência inválida gravam `REJECTED`, sem lançamento.

`REFUND` credita uma `BET` `PROCESSED`, uma vez, no mesmo valor e no mesmo provedor, jogador, wallet, moeda e rodada. Sem `referenceExternalTransactionId` a resposta é `400`. Referência que ainda não existe fica `PENDING_REFERENCE`, sem crédito. Valor diferente é `AMOUNT_MISMATCH`. A segunda `REFUND` da mesma aposta é `ALREADY_REVERSED`. Isso vale também quando a referência ainda não apareceu e já existe uma reversão ativa daquele tipo. Duas `REFUND` em paralelo deixam um crédito. Como o efeito é crédito, o saldo não fica negativo.

`ROLLBACK` inverte uma `BET`, `WIN` ou `REFUND` `PROCESSED`, uma vez, valor igual, no mesmo escopo. Sem o campo de referência a resposta é `400`. Referência ausente fica `PENDING_REFERENCE`. `BET` vira `CREDIT`. `WIN` e `REFUND` viram `DEBIT`. `LOSS` não serve de referência. O índice é por tipo, então `REFUND` e `ROLLBACK` da mesma aposta convivem. A segunda do mesmo tipo é `ALREADY_REVERSED`. Se o débito deixaria o saldo negativo, a transação fica `REJECTED` com `REVERSAL_EXCEEDS_BALANCE`, sem lançamento. O código da aposta sem saldo continua sendo `INSUFFICIENT_BALANCE`.

## Referência atrasada

`WIN`, `LOSS`, `REFUND` e `ROLLBACK` sem a linha de referência ficam `PENDING_REFERENCE`, sem lançamento. Um worker no processo olha essas linhas a cada 1s. A espera cresce 1s, 2s, 4s, 8s e 16s, em `reference_attempts` e `reference_next_attempt_at`. Na quinta vez sem a referência, vira `REJECTED` com `REFERENCE_NOT_FOUND` e sai `WagerTransactionRejected`. A soma dá 31s, o bastante para uma reordenação curta.

O claim é `for update skip locked` da pendente e, em seguida, o lock da wallet. Duas instâncias não pegam a mesma linha. Enquanto espera, o replay segue `202`. Quando resolve, o replay devolve o resultado final e o saldo daquele momento.

## HTTP

Um mapa para todos os endpoints: `201` processada, `202` referência pendente, `422` rejeição de negócio, `400` payload inválido, `404` carteira ou transação ausente, `409` conflito de carteira, de id externo ou de payload, `503` falha transitória, `500` erro de programa. O `503` da aposta cobre deadlock, timeout de lock e queda de conexão. O corpo leva o código (`unavailable`, `internal`, `transaction_conflict`) e não a mensagem da exceção, para não vazar valor. O replay reutiliza o status original.

`GET /wallets/:walletId/ledger` ordena por `created_at` e, no empate, por `id`. O cursor é o id do último lançamento da página, em base64url. A página seguinte traz as linhas da mesma wallet com `(created_at, id)` maior que essa. O mesmo cursor devolve a mesma página. Lançamento novo aparece depois dela. O limite padrão é 50 e o teto é 100. Cursor ou limite inválido responde `400`. Wallet ausente responde `404`. A rota só lê.

`GET /wagering/transactions/:transactionId` e `GET /providers/:providerId/wagering/transactions/:externalTransactionId` devolvem o mesmo corpo. O `balance` é o `observed_balance` da linha, não o saldo vivo da wallet. O mesmo id externo em outro provedor é outra transação, pela unique `(provider_id, external_transaction_id)`. Id que não é uuid, provider em branco ou id externo em branco respondem `400`. Ausente responde `404` com `transaction_not_found`.

`POST /wallets/:walletId/reconciliation` compara o saldo gravado com a soma do ledger. `difference` é o gravado menos a soma. Quando os dois batem, `consistent` fica verdadeiro e `difference` é `0.00`. Quando divergem, a resposta continua `200`, com `consistent: false`. Conto em `reconciliationDivergences` e gravo um log sem valor. A wallet não é corrigida. Wallet ausente responde `404`. Id inválido responde `400`.

`GET /health/live` e `GET /health/ready` não pedem autenticação. Live só diz que o processo atende. Ready faz `select 1` e fala com a fila de `SQS_QUEUE_URL`. Os dois precisam responder. Se um falha, a resposta é `503` com `postgres` e `sqs` em booleano, sem URL e sem saldo. Esse `503` é dependência fora do ar. O da aposta, no meio de um deadlock, é outro corpo.

## Fila e outbox

A mensagem entra no mesmo `SubmitWager` da HTTP. Inbox, wallet, ledger quando existe, e outbox vão na mesma transação SQL. O `delete` da mensagem só acontece depois do commit. Rejeição de negócio dá ack. Payload inválido, wallet ausente ou conflito de payload vão para `wager-transactions-dlq.fifo`. Erro transitório devolve a visibilidade em 1s, 2s e 4s. Na quinta tentativa, a mensagem vai para a DLQ. `SIGTERM` espera o que está em voo. Se não termina a tempo, a visibilidade volta a zero.

O FIFO não segura o saldo. A mesma mensagem, com outro id de deduplicação, não debita de novo: quem segura é a inbox junto com a idempotency key.

`WagerTransactionProcessed` (inclui `LOSS`), `WagerTransactionRejected`, `WalletBalanceChanged` e `WagerTransactionPendingReference` são subclasses de `IntegrationEvent`. `WalletBalanceChanged` só sai quando o saldo muda. `eventType` e `version` ficam na classe. `correlationId` é o id da transação. O agregado da transação é o id dela. O de `WalletBalanceChanged` é o id da wallet.

`published_at` nasce nulo. A publicação não acontece dentro da transação do saldo, e uma linha ainda aberta não aparece para o publisher. `OPENING` com saldo grava os dois eventos. Saldo inicial zero não grava evento. `REJECTED` e `PENDING_REFERENCE` não gravam `WalletBalanceChanged`. Replay não grava de novo.

O publisher lê a outbox já commitada. O claim é `for update skip locked` de uma pendente com `next_attempt_at` nulo ou vencido. `scheduleRetry` confirma a reserva antes de chamar o SQS: 1s, 2s, 4s, teto de 60s. Se o processo morre antes do envio, ou depois do envio e antes de gravar `published_at`, outra instância pega a linha quando a reserva vence. A fila de saída é `integration-events.fifo`. Mudei o `MessageDeduplicationId` a cada envio para o FIFO não esconder a republicação. O corpo repete o mesmo `eventId`. O consumidor `integration-events` grava a inbox por esse id, e a segunda cópia não cria outra linha. Linha já publicada não volta para a fila. O payload não muda, e delete na outbox continua recusado.

## Log

Cada linha é um JSON. `correlationId`, `messageId`, `transactionId`, `walletId` e `providerId` entram sempre. O que não existe fica `null`. Na HTTP, `correlationId` vem de `x-correlation-id`. Sem o header, uso o id da transação ou da wallet. Na fila, uso o `messageId`. O log leva o nome do erro, não o texto. Valor, saldo e corpo do pedido ficam de fora. Um id numérico é descartado.

Os contadores do processo cobrem status, duplicata, retry, DLQ, conflito de lock, atraso da outbox e latência, em milissegundos inteiros. Duplicata não conta de novo como transação. Esses números morrem com o processo e não se somam entre instâncias. A idempotência continua na unique do Postgres.

## Auth

Não implementei autenticação. Não há tabela de usuário nem hash de senha. O desenho que eu adotaria é Keycloak na frente de `POST /wallets` e `POST /wagering/transactions`. O gancho no código é `ProviderIdentityPort`. `UnconfiguredIdentity` recusa o token. `OpenAccessGuard` existe e não está registrado, então as rotas seguem abertas. Health continua aberto. A fila é canal interno. Se o `playerId` da mensagem não for o da wallet, a aposta fica `REJECTED` com `PLAYER_MISMATCH`, sem lançamento.

## Fora desta entrega

OpenTelemetry, teste de carga e partidas dobradas. O status `FAILED` existe no domínio e no check do schema. Nenhum fluxo grava essa linha. Erro permanente da fila vai para a DLQ.
