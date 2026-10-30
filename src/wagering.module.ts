import { Module } from "@nestjs/common";
import { GetWager } from "./application/wagering/get-wager";
import { PendingReferenceWorker } from "./application/wagering/pending-reference-worker";
import { SubmitWager } from "./application/wagering/submit-wager";
import { WagerRepository } from "./application/wagering/wager-repository";
import { SqlWagerRepository } from "./infra/database/sql-wager-repository";
import { ProviderWagerController } from "./infra/http/provider-wager.controller";
import { WageringController } from "./infra/http/wagering.controller";

@Module({
  controllers: [WageringController, ProviderWagerController],
  providers: [
    PendingReferenceWorker,
    {
      provide: SubmitWager,
      useFactory: (wagers: WagerRepository) => new SubmitWager(wagers),
      inject: [WagerRepository],
    },
    {
      provide: GetWager,
      useFactory: (wagers: WagerRepository) => new GetWager(wagers),
      inject: [WagerRepository],
    },
    {
      provide: WagerRepository,
      useClass: SqlWagerRepository,
    },
  ],
})
export class WageringModule {}
