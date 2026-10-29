# Architecture

Documento vivo. Cada decisão entra aqui no momento em que é tomada.

## Neste passo

Aplicação única em Bun 1.4 e NestJS 12, com TypeScript em `strict`. O processo sobe por `bun src/main.ts`. O runner de teste do desafio é o Bun; Jest fica de fora.

Três pastas separam o código, ainda sem regra de negócio:

- `src/domain` — invariantes, sem Nest e sem ORM
- `src/application` — casos de uso
- `src/infra` — banco, fila e HTTP

Compose local sobe PostgreSQL 16 e LocalStack só com SQS. A aplicação ainda não conecta nos dois.

## Ainda em aberto

ORM (MikroORM é o preferido do desafio; TypeORM é aceito), migrations, `Money` e o mapa de portas. Entram no próximo passo, junto com a justificativa.
