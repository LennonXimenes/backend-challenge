import { Body, Controller, Get, Headers, Param, Post, Res } from "@nestjs/common";
import { GetWager } from "../../application/wagering/get-wager";
import { SubmitWager } from "../../application/wagering/submit-wager";
import { recordWager } from "../../application/observability/operation-metrics";
import { writeOperationLog } from "../../application/observability/operation-log";
import { parseWagerBody } from "./parse-wager";
import { wagerLookupBody } from "./wager-lookup-body";

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
    const body = wagerLookupBody(stored);
    writeOperationLog({
      level: "info",
      message: "wager read",
      correlationId: correlationId ?? body.transactionId,
      transactionId: body.transactionId,
      walletId: body.walletId,
      providerId: body.providerId,
      outcome: body.status,
    });
    return body;
  }
}
