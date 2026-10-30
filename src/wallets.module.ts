import { Module } from "@nestjs/common";
import { GetWallet } from "./application/wallets/get-wallet";
import { ListLedger } from "./application/wallets/list-ledger";
import { OpenWallet } from "./application/wallets/open-wallet";
import { ReconcileWallet } from "./application/wallets/reconcile-wallet";
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
      provide: ListLedger,
      useFactory: (wallets: WalletRepository) => new ListLedger(wallets),
      inject: [WalletRepository],
    },
    {
      provide: ReconcileWallet,
      useFactory: (wallets: WalletRepository) => new ReconcileWallet(wallets),
      inject: [WalletRepository],
    },
    {
      provide: WalletRepository,
      useClass: SqlWalletRepository,
    },
  ],
})
export class WalletsModule {}
