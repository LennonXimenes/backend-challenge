import { Body, Controller, Headers, Post, Res } from "@nestjs/common";
import { SubmitWager } from "../../application/wagering/submit-wager";
import { writeOperationLog } from "../../application/observability/operation-log";
import { parseWagerBody } from "./parse-wager";

interface StatusResponse {
  status(code: number): void;
}

@Controller("wagering")
export class WageringController {
  constructor(private readonly submitWager: SubmitWager) {}

  @Post("transactions")
  async create(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-correlation-id") correlationId: string | undefined,
    @Res({ passthrough: true }) response: StatusResponse,
  ) {
    const command = parseWagerBody(body, idempotencyKey);
    const result = await this.submitWager.execute(command);
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
}
