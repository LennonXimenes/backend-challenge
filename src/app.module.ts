import { Module } from "@nestjs/common";
import { DatabaseModule } from "./infra/database/database.module";
import { WalletsModule } from "./wallets.module";

@Module({
  imports: [DatabaseModule.forRoot(), WalletsModule],
})
export class AppModule {}
