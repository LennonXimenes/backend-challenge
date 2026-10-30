import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import { httpFailure } from "../../application/http/http-failure";
import { writeOperationLog } from "../../application/observability/operation-log";

interface RequestLogSource {
  headers?: Record<string, string | string[] | undefined>;
  params?: { walletId?: string; transactionId?: string; providerId?: string };
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
      transactionId: request.params?.transactionId ?? null,
      providerId: request.params?.providerId ?? null,
      error: exception instanceof Error ? exception.name : "Error",
    });

    const failure = httpFailure(exception);
    response.status(failure.status).json(failure.body);
  }
}
