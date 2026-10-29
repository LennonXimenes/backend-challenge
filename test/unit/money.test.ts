import { describe, expect, test } from "bun:test";
import { CurrencyMismatchError, InvalidMoneyError } from "../../src/domain/money/money-error";
import { Money } from "../../src/domain/money/money";

describe("Money", () => {
  test("serializes a fixed scale of 2 and does not mutate on arithmetic", () => {
    const original = Money.from({ amount: "25", currency: "BRL" });

    expect(original.toJSON()).toEqual({ amount: "25.00", currency: "BRL" });
    expect(original.add(Money.from({ amount: "0.10", currency: "BRL" })).toJSON().amount).toBe("25.10");
    expect(original.toJSON().amount).toBe("25.00");
    expect(Money.from({ amount: "0.10", currency: "BRL" }).add(Money.from({ amount: "0.20", currency: "BRL" })).toJSON().amount).toBe(
      "0.30",
    );
  });

  test("rejects invalid amounts instead of rounding", () => {
    const invalid = ["", " ", "NaN", "Infinity", "-Infinity", "1e2", "1E+2", "25.001", "1.2300", "-1.00", "+25.00", "00.50", ".50"];

    for (const amount of invalid) {
      expect(() => Money.from({ amount, currency: "BRL" })).toThrow(InvalidMoneyError);
    }

    expect(() => Money.from({ amount: 25 as unknown as string, currency: "BRL" })).toThrow(InvalidMoneyError);
    expect(Money.from({ amount: "25.10", currency: "BRL" }).toJSON().amount).toBe("25.10");
  });

  test("rejects a currency that is not ISO-4217 and operations across currencies", () => {
    expect(() => Money.from({ amount: "1.00", currency: "brl" })).toThrow(InvalidMoneyError);
    expect(() => Money.zero("US")).toThrow(InvalidMoneyError);

    const brl = Money.from({ amount: "10.00", currency: "BRL" });
    const usd = Money.from({ amount: "10.00", currency: "USD" });

    expect(() => brl.add(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.subtract(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.isLessThan(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.equals(usd)).toThrow(CurrencyMismatchError);
  });

  test("compares and negates within the same currency", () => {
    const ten = Money.from({ amount: "10.00", currency: "BRL" });
    const zero = Money.zero("BRL");

    expect(zero.isZero()).toBe(true);
    expect(zero.isPositive()).toBe(false);
    expect(zero.isNegative()).toBe(false);
    expect(ten.isPositive()).toBe(true);
    expect(ten.isLessThan(Money.from({ amount: "10.01", currency: "BRL" }))).toBe(true);
    expect(ten.equals(Money.from({ amount: "10.00", currency: "BRL" }))).toBe(true);
    expect(ten.negate().toJSON()).toEqual({ amount: "-10.00", currency: "BRL" });
    expect(ten.negate().isNegative()).toBe(true);
    expect(ten.subtract(Money.from({ amount: "3.00", currency: "BRL" })).toString()).toBe("7.00 BRL");
  });
});
