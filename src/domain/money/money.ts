import Decimal from "decimal.js";
import { CurrencyMismatchError, InvalidMoneyError } from "./money-error";

const ExactDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
});

const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,16})(?:\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export interface MoneyProps {
  amount: string;
  currency: string;
}

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    return new Money(parseAmount(props.amount), parseCurrency(props.currency));
  }

  static zero(currency: string): Money {
    return new Money(new ExactDecimal(0), parseCurrency(currency));
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  isNegative(): boolean {
    return this.value.lessThan(0);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return {
      amount: this.value.toFixed(2),
      currency: this.currency,
    };
  }

  toString(): string {
    return `${this.value.toFixed(2)} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}

function parseAmount(amount: string): Decimal {
  if (typeof amount !== "string" || !AMOUNT_PATTERN.test(amount)) {
    throw new InvalidMoneyError("amount must be a non-negative decimal string with at most 2 decimal places");
  }

  return new ExactDecimal(amount);
}

function parseCurrency(currency: string): string {
  if (typeof currency !== "string" || !CURRENCY_PATTERN.test(currency)) {
    throw new InvalidMoneyError("currency must be an ISO-4217 code");
  }

  return currency;
}
