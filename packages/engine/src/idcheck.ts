export interface IdCheckResult {
  result: "verified" | "failed";
  verifiedName: string | null;
  providerRef: string;
  reason?: string;
}

export interface IdProvider {
  readonly name: string;
  check(type: "nin" | "bvn", number: string, nameOnAccount: string): Promise<IdCheckResult>;
}

/** Development only: any 11-digit number passes, with the name the person gave. */
export class FakeIdProvider implements IdProvider {
  readonly name = "fake";
  async check(type: "nin" | "bvn", number: string, nameOnAccount: string): Promise<IdCheckResult> {
    const providerRef = `fake_${type}_${crypto.randomUUID()}`;
    if (!/^\d{11}$/.test(number)) return { result: "failed", verifiedName: null, providerRef, reason: `A ${type.toUpperCase()} has 11 digits.` };
    return { result: "verified", verifiedName: nameOnAccount.trim(), providerRef };
  }
}
