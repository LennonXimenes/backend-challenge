import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from "@nestjs/common";
import { InvalidMoneyError } from "../../domain/money/money-error";
import { InvalidWalletInputError, WalletAlreadyExistsError, WalletNotFoundError } from "../../domain/wallet/wallet-error";

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

@Catch()
export class WalletExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(WalletExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();

    if (exception instanceof InvalidMoneyError || exception instanceof InvalidWalletInputError) {
      response.status(HttpStatus.BAD_REQUEST).json({ error: "invalid_payload" });
      return;
    }

    if (exception instanceof WalletAlreadyExistsError) {
      response.status(HttpStatus.CONFLICT).json({ error: "wallet_conflict" });
      return;
    }

    if (exception instanceof WalletNotFoundError) {
      response.status(HttpStatus.NOT_FOUND).json({ error: "wallet_not_found" });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.name : "unknown_error");
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "internal" });
  }
}
