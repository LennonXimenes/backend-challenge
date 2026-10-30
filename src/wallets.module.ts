import { Module } from "@nestjs/common";
import { GetWallet } from "./application/wallets/get-wallet";
import { OpenWallet } from "./application/wallets/open-wallet";
import { WalletRepository } from "./application/wallets/wallet-repository";
import { SqlWalletRepository } from "./infra/database/sql-wallet-repository";
import { WalletsController } from "./infra/http/wallets.controller";

@Module({
  controllers: [WalletsController],
  providers: [
    {
      provide: OpenWallet,
      useFactory: (wallets: WalletRepository) => new OpenWallet(wallets),
      inject: [WalletRepository],
    },
    {
      provide: GetWallet,
      useFactory: (wallets: WalletRepository) => new GetWallet(wallets),
      inject: [WalletRepository],
    },
    {
      provide: WalletRepository,
      useClass: SqlWalletRepository,
    },
  ],
})
export class WalletsModule {}
