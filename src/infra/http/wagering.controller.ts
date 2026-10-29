import { Body, Controller, Headers, Post, Res } from "@nestjs/common";
import { SubmitWager } from "../../application/wagering/submit-wager";
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
    @Res({ passthrough: true }) response: StatusResponse,
  ) {
    const result = await this.submitWager.execute(parseWagerBody(body, idempotencyKey));
    response.status(result.httpStatus);
    return result.body;
  }
}
