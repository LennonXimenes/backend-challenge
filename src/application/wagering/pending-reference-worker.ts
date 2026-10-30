import { Injectable } from "@nestjs/common";
import { WagerRepository } from "./wager-repository";

@Injectable()
export class PendingReferenceWorker {
  constructor(private readonly wagers: WagerRepository) {}

  run(now: Date): Promise<boolean> {
    return this.wagers.resumeNext(now);
  }
}
