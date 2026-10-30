import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from "@nestjs/common";
import { GetWallet } from "../../application/wallets/get-wallet";
import { ListLedger } from "../../application/wallets/list-ledger";
import { OpenWallet } from "../../application/wallets/open-wallet";
import { writeOperationLog } from "../../application/observability/operation-log";
import { parseOpenWalletBody } from "./parse-open-wallet";

@Controller("wallets")
export class WalletsController {
  constructor(
    private readonly openWallet: OpenWallet,
    private readonly getWallet: GetWallet,
    private readonly listLedger: ListLedger,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown, @Headers("x-correlation-id") correlationId: string | undefined) {
    const wallet = await this.openWallet.execute(parseOpenWalletBody(body));
    writeOperationLog({
      level: "info",
      message: "wallet opened",
      correlationId: correlationId ?? wallet.id,
      walletId: wallet.id,
    });
    return wallet.toJSON();
  }

  @Get(":walletId/ledger")
  async ledger(
    @Param("walletId") walletId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const page = await this.listLedger.execute(walletId, cursor, limit);
    writeOperationLog({
      level: "info",
      message: "ledger listed",
      walletId,
    });
    return {
      entries: page.entries.map((entry) => ({
        id: entry.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        createdAt: entry.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  @Get(":walletId")
  async find(@Param("walletId") walletId: string) {
    const wallet = await this.getWallet.execute(walletId);
    return wallet.toJSON();
  }
}
