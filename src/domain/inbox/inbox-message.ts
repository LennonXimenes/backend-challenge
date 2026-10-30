export class InvalidInboxStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInboxStateError";
  }
}

export class InboxMessage {
  private constructor(
    readonly messageId: string,
    readonly consumerName: string,
    readonly payloadHash: string,
    readonly receivedAt: Date,
    private _processedAt?: Date,
  ) {}

  static receive(props: {
    messageId: string;
    consumerName: string;
    payloadHash: string;
    receivedAt: Date;
  }): InboxMessage {
    if (props.messageId.trim() === "" || props.consumerName.trim() === "" || props.payloadHash.trim() === "") {
      throw new InvalidInboxStateError("inbox identity is required");
    }

    return new InboxMessage(props.messageId, props.consumerName, props.payloadHash, props.receivedAt);
  }

  static rehydrate(state: {
    messageId: string;
    consumerName: string;
    payloadHash: string;
    receivedAt: Date;
    processedAt?: Date;
  }): InboxMessage {
    return new InboxMessage(
      state.messageId,
      state.consumerName,
      state.payloadHash,
      state.receivedAt,
      state.processedAt,
    );
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  isProcessed(): boolean {
    return this._processedAt !== undefined;
  }

  markProcessed(at: Date): void {
    if (this._processedAt) {
      throw new InvalidInboxStateError("inbox message is already processed");
    }

    this._processedAt = at;
  }
}
