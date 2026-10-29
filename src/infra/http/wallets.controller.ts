import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { GetWallet } from "../../application/wallets/get-wallet";
import { OpenWallet } from "../../application/wallets/open-wallet";
import { parseOpenWalletBody } from "./parse-open-wallet";

@Controller("wallets")
export class WalletsController {
  constructor(
    private readonly openWallet: OpenWallet,
    private readonly getWallet: GetWallet,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown) {
    const wallet = await this.openWallet.execute(parseOpenWalletBody(body));
    return wallet.toJSON();
  }

  @Get(":walletId")
  async find(@Param("walletId") walletId: string) {
    const wallet = await this.getWallet.execute(walletId);
    return wallet.toJSON();
  }
}
