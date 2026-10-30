import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from "@nestjs/common";
import { InvalidMoneyError } from "../../domain/money/money-error";
import { InvalidWalletInputError, WalletAlreadyExistsError, WalletNotFoundError } from "../../domain/wallet/wallet-error";
import { WagerConflictError } from "../../domain/wager/wager-error";
import { writeOperationLog } from "../../application/observability/operation-log";

interface RequestLogSource {
  headers?: Record<string, string | string[] | undefined>;
  params?: { walletId?: string };
}

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

@Catch()
export class WalletExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestLogSource>();
    const response = http.getResponse<JsonResponse>();
    const correlation = request.headers?.["x-correlation-id"];
    writeOperationLog({
      level: "error",
      message: "request failed",
      correlationId: typeof correlation === "string" ? correlation : null,
      walletId: request.params?.walletId ?? null,
      error: exception instanceof Error ? exception.name : "Error",
    });

    if (exception instanceof InvalidMoneyError || exception instanceof InvalidWalletInputError) {
      response.status(HttpStatus.BAD_REQUEST).json({ error: "invalid_payload" });
      return;
    }

    if (exception instanceof WalletAlreadyExistsError) {
      response.status(HttpStatus.CONFLICT).json({ error: "wallet_conflict" });
      return;
    }

    if (exception instanceof WagerConflictError) {
      response.status(HttpStatus.CONFLICT).json({ error: "transaction_conflict" });
      return;
    }

    if (exception instanceof WalletNotFoundError) {
      response.status(HttpStatus.NOT_FOUND).json({ error: "wallet_not_found" });
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "internal" });
  }
}
