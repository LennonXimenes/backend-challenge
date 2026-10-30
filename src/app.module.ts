import { Module } from "@nestjs/common";
import { DatabaseModule } from "./infra/database/database.module";
import { WageringModule } from "./wagering.module";
import { WalletsModule } from "./wallets.module";

@Module({
  imports: [DatabaseModule.forRoot(), WalletsModule, WageringModule],
})
export class AppModule {}
