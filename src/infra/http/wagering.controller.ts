import { Body, Controller, Get, Headers, Param, Post, Res } from "@nestjs/common";
import { GetWager } from "../../application/wagering/get-wager";
import { SubmitWager } from "../../application/wagering/submit-wager";
import { recordWager } from "../../application/observability/operation-metrics";
import { writeOperationLog } from "../../application/observability/operation-log";
import { parseWagerBody } from "./parse-wager";

interface StatusResponse {
  status(code: number): void;
}

@Controller("wagering")
export class WageringController {
  constructor(
    private readonly submitWager: SubmitWager,
    private readonly getWager: GetWager,
  ) {}

  @Post("transactions")
  async create(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-correlation-id") correlationId: string | undefined,
    @Res({ passthrough: true }) response: StatusResponse,
  ) {
    const command = parseWagerBody(body, idempotencyKey);
    const started = Date.now();
    const result = await this.submitWager.execute(command);
    recordWager(result.body.status, result.body.idempotentReplay, Date.now() - started);
    writeOperationLog({
      level: "info",
      message: "wager submitted",
      correlationId: correlationId ?? result.body.transactionId,
      transactionId: result.body.transactionId,
      walletId: command.walletId,
      providerId: command.providerId,
      outcome: result.body.status,
    });
    response.status(result.httpStatus);
    return result.body;
  }

  @Get("transactions/:transactionId")
  async find(
    @Param("transactionId") transactionId: string,
    @Headers("x-correlation-id") correlationId: string | undefined,
  ) {
    const stored = await this.getWager.execute(transactionId);
    const transaction = stored.transaction;
    writeOperationLog({
      level: "info",
      message: "wager read",
      correlationId: correlationId ?? transaction.id,
      transactionId: transaction.id,
      walletId: transaction.walletId,
      providerId: transaction.providerId,
      outcome: transaction.status,
    });
    return {
      transactionId: transaction.id,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      playerId: transaction.playerId,
      walletId: transaction.walletId,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      kind: transaction.kind,
      money: transaction.money.toJSON(),
      status: transaction.status,
      failureCode: transaction.failureCode ?? null,
      balance: stored.balance,
      referenceExternalTransactionId: transaction.referenceExternalTransactionId ?? null,
      createdAt: transaction.createdAt.toISOString(),
      processedAt: transaction.processedAt?.toISOString() ?? null,
    };
  }
}
