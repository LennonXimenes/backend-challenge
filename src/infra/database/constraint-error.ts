import { UniqueConstraintViolationException } from "@mikro-orm/core";

export function constraintText(error: unknown): string {
  const parts: string[] = [];
  const queue: unknown[] = [error];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") {
      continue;
    }

    if (current instanceof UniqueConstraintViolationException || current instanceof Error) {
      parts.push(current.message);
    }

    if ("constraint" in current && typeof current.constraint === "string") {
      parts.push(current.constraint);
    }

    if ("cause" in current) {
      queue.push(current.cause);
    }
  }

  return parts.join(" ");
}
