export interface ProviderIdentity {
  providerId: string;
}

export interface ProviderIdentityPort {
  authenticate(credential: string): Promise<ProviderIdentity>;
}

export class IdentityNotConfiguredError extends Error {
  constructor() {
    super("identity provider is not configured");
    this.name = "IdentityNotConfiguredError";
  }
}

export class UnconfiguredIdentity implements ProviderIdentityPort {
  authenticate(_credential: string): Promise<ProviderIdentity> {
    return Promise.reject(new IdentityNotConfiguredError());
  }
}
