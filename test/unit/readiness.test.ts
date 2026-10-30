import { describe, expect, test } from "bun:test";
import { Readiness } from "../../src/application/health/readiness";

describe("readiness", () => {
  test("is ready only when postgres and sqs both answer", async () => {
    const ready = await new Readiness(async () => undefined, async () => undefined).execute();
    expect(ready).toEqual({ postgres: true, sqs: true });

    const withoutSqs = await new Readiness(async () => undefined, async () => {
      throw new Error("down");
    }).execute();
    expect(withoutSqs).toEqual({ postgres: true, sqs: false });

    const withoutPostgres = await new Readiness(async () => {
      throw new Error("down");
    }, async () => undefined).execute();
    expect(withoutPostgres).toEqual({ postgres: false, sqs: true });
  });
});
