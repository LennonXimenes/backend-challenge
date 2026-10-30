import { Type } from "@mikro-orm/core";

export class NumericStringType extends Type<string, string> {
  override convertToDatabaseValue(value: string): string {
    return numericString(value);
  }

  override convertToJSValue(value: string): string {
    return numericString(value);
  }

  override getColumnType(): string {
    return "numeric(19,2)";
  }

  override compareAsType(): string {
    return "string";
  }
}

export function normalizeAmount(amount: string): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  return `${whole}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

function numericString(value: string): string {
  if (typeof value !== "string") {
    throw new Error("numeric column must stay a string");
  }

  return normalizeAmount(value);
}
