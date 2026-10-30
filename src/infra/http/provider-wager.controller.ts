import { Controller, Get, Headers, Param } from "@nestjs/common";
import { GetWager } from "../../application/wagering/get-wager";
import { writeOperationLog } from "../../application/observability/operation-log";
import { wagerLookupBody } from "./wager-lookup-body";

@Controller("providers")
export class ProviderWagerController {
  constructor(private readonly getWager: GetWager) {}

  @Get(":providerId/wagering/transactions/:externalTransactionId")
  async find(
    @Param("providerId") providerId: string,
    @Param("externalTransactionId") externalTransactionId: string,
    @Headers("x-correlation-id") correlationId: string | undefined,
  ) {
    const stored = await this.getWager.executeByExternal(providerId, externalTransactionId);
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
