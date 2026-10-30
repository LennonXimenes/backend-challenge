import { Body, Controller, Get, Headers, HttpCode, Param, Post } from "@nestjs/common";
import { GetWallet } from "../../application/wallets/get-wallet";
import { OpenWallet } from "../../application/wallets/open-wallet";
import { writeOperationLog } from "../../application/observability/operation-log";
import { parseOpenWalletBody } from "./parse-open-wallet";

@Controller("wallets")
export class WalletsController {
  constructor(
    private readonly openWallet: OpenWallet,
    private readonly getWallet: GetWallet,
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

  @Get(":walletId")
  async find(@Param("walletId") walletId: string) {
    const wallet = await this.getWallet.execute(walletId);
    return wallet.toJSON();
  }
}
