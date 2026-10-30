import { recordReconciliationDivergence } from "../observability/operation-metrics";
import { writeOperationLog } from "../observability/operation-log";
import { Money } from "../../domain/money/money";
import { InvalidWalletInputError, WalletNotFoundError } from "../../domain/wallet/wallet-error";
import { WalletRepository } from "./wallet-repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Reconciliation {
  walletId: string;
  storedBalance: Money;
  calculatedBalance: Money;
  difference: Money;
  consistent: boolean;
  checkedEntries: number;
}

export class ReconcileWallet {
  constructor(private readonly wallets: WalletRepository) {}

  async execute(walletId: string): Promise<Reconciliation> {
    if (!UUID_PATTERN.test(walletId)) {
      throw new InvalidWalletInputError("walletId must be a uuid");
    }

    const wallet = await this.wallets.findById(walletId);
    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    const ledger = await this.wallets.sumLedger(walletId);
    const calculated = Money.from({ amount: ledger.amount, currency: wallet.currency });
    const difference = wallet.balance.subtract(calculated);
    const consistent = difference.isZero();
    if (!consistent) {
      recordReconciliationDivergence();
      writeOperationLog({
        level: "error",
        message: "reconciliation diverged",
        walletId,
        outcome: "divergent",
      });
    }

    return {
      walletId,
      storedBalance: wallet.balance,
      calculatedBalance: calculated,
      difference,
      consistent,
      checkedEntries: ledger.entries,
    };
  }
}
