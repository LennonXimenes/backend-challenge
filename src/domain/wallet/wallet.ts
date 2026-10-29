import { Money } from "../money/money";
import { LedgerDirection } from "./ledger-direction";
import { InvalidWalletInputError } from "./wallet-error";
import { WalletLedgerEntry } from "./wallet-ledger-entry";
import { WagerTransaction } from "../wager/wager-transaction";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OpenedWallet {
  wallet: Wallet;
  opening?: {
    transaction: WagerTransaction;
    entry: WalletLedgerEntry;
  };
}

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Wallet {
  private constructor(
    readonly id: string,
    readonly playerId: string,
    readonly currency: string,
    private readonly _balance: Money,
    private readonly _version: number,
    readonly createdAt: Date,
    private readonly _updatedAt: Date,
  ) {}

  static open(props: {
    id: string;
    playerId: string;
    initialBalance: Money;
    openedAt: Date;
    openingTransactionId: string;
    openingLedgerId: string;
  }): OpenedWallet {
    assertUuid(props.id, "id");
    assertUuid(props.playerId, "playerId");

    const wallet = new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      props.openedAt,
      props.openedAt,
    );

    if (props.initialBalance.isZero()) {
      return { wallet };
    }

    assertUuid(props.openingTransactionId, "openingTransactionId");
    assertUuid(props.openingLedgerId, "openingLedgerId");

    const transaction = WagerTransaction.opening({
      id: props.openingTransactionId,
      walletId: props.id,
      playerId: props.playerId,
      money: props.initialBalance,
      at: props.openedAt,
    });
    const entry = WalletLedgerEntry.create({
      id: props.openingLedgerId,
      walletId: props.id,
      transactionId: transaction.id,
      direction: LedgerDirection.Credit,
      money: props.initialBalance,
      balanceBefore: Money.zero(props.initialBalance.currency),
      balanceAfter: props.initialBalance,
      createdAt: props.openedAt,
    });

    return { wallet, opening: { transaction, entry } };
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(state.id, state.playerId, state.currency, state.balance, state.version, state.createdAt, state.updatedAt);
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  toJSON(): { id: string; playerId: string; balance: { amount: string; currency: string }; version: number } {
    return {
      id: this.id,
      playerId: this.playerId,
      balance: this._balance.toJSON(),
      version: this._version,
    };
  }
}

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new InvalidWalletInputError(`${field} must be a uuid`);
  }
}
