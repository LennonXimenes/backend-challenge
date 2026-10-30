export class Readiness {
  constructor(
    private readonly checkPostgres: () => Promise<void>,
    private readonly checkSqs: () => Promise<void>,
  ) {}

  async execute(): Promise<{ postgres: boolean; sqs: boolean }> {
    const [postgres, sqs] = await Promise.all([
      this.checkPostgres().then(() => true, () => false),
      this.checkSqs().then(() => true, () => false),
    ]);
    return { postgres, sqs };
  }
}
