import { Controller, Get, Res } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/postgresql";
import { Readiness } from "../../application/health/readiness";
import { probePostgres, probeSqs } from "../health/probes";

interface StatusResponse {
  status(code: number): void;
}

@Controller("health")
export class HealthController {
  constructor(private readonly orm: MikroORM) {}

  @Get("live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  async ready(@Res({ passthrough: true }) response: StatusResponse): Promise<{
    status: "ok" | "unavailable";
    postgres: boolean;
    sqs: boolean;
  }> {
    const result = await new Readiness(() => probePostgres(this.orm), probeSqs).execute();
    const ready = result.postgres && result.sqs;
    response.status(ready ? 200 : 503);
    return {
      status: ready ? "ok" : "unavailable",
      postgres: result.postgres,
      sqs: result.sqs,
    };
  }
}
