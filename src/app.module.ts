import { Module } from "@nestjs/common";
import { DatabaseModule } from "./infra/database/database.module";
import { HealthModule } from "./health.module";
import { WageringModule } from "./wagering.module";
import { WalletsModule } from "./wallets.module";

@Module({
  imports: [DatabaseModule.forRoot(), HealthModule, WalletsModule, WageringModule],
})
export class AppModule {}
