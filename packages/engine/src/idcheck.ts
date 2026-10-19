import { DealError } from "./core";

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

/** Words in a name, for comparing: lower case, no punctuation. */
const words = (s: string) => s.toLowerCase().replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter(Boolean);
/** Every word of the shorter name is in the longer one, in any order ("Bakare Tunde" matches "TUNDE OLU BAKARE"). */
const sameName = (a: string, b: string) => {
  const [x, y] = [words(a), words(b)].sort((p, q) => p.length - q.length);
  return x.length >= 2 && x.every((w) => y.includes(w));
};
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * Dojah (dojah.io): NIN and BVN lookups against NIMC and NIBSS. The number must exist, and the name on the person's
 * NosHen account must match the name on it. When it doesn't, the record's name is never shown, so nobody can learn
 * a stranger's name by trying numbers. Only the result and the verified name are kept (not the photo, birth date or
 * phone that come back).
 *
 * The sandbox (sandbox.dojah.io) answers only Dojah's test numbers (NIN 70123456789, BVN 22222222222), with made-up
 * people, so there the name the person gave is taken as the verified name. It never charges.
 */
export class DojahIdProvider implements IdProvider {
  readonly name: string;
  constructor(private o: { appId: string; secretKey: string; sandbox: boolean; fetch?: typeof fetch }) {
    this.name = o.sandbox ? "dojah-sandbox" : "dojah";
  }

  async check(type: "nin" | "bvn", number: string, nameOnAccount: string): Promise<IdCheckResult> {
    const providerRef = `${this.name}_${type}_${crypto.randomUUID()}`;
    if (!/^\d{11}$/.test(number)) return { result: "failed", verifiedName: null, providerRef, reason: `A ${type.toUpperCase()} has 11 digits.` };
    const base = this.o.sandbox ? "https://sandbox.dojah.io" : "https://api.dojah.io";
    const path = type === "nin" ? `/api/v1/kyc/nin?nin=${number}` : `/api/v1/kyc/bvn/full?bvn=${number}`;
    let res: Response;
    try {
      res = await (this.o.fetch ?? fetch)(base + path, { headers: { AppId: this.o.appId, Authorization: this.o.secretKey, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      console.error("dojah: no answer", e);
      throw new DealError("id_unavailable", "We couldn't reach the ID check just now. Try again in a few minutes.", 503);
    }
    if (res.status === 404 || res.status === 400) {
      return { result: "failed", verifiedName: null, providerRef, reason: `We couldn't find that ${type.toUpperCase()}. Check the 11 digits and try again.` };
    }
    if (!res.ok) {
      // NosHen's side (keys, wallet) or Dojah's (the source is down): nothing is wrong with the person's number.
      console.error("dojah: status", res.status, (await res.text().catch(() => "")).slice(0, 300));
      throw new DealError("id_unavailable", "The ID check isn't available just now. Try again in a little while.", 503);
    }
    const e = ((await res.json().catch(() => null)) as { entity?: Record<string, unknown> } | null)?.entity;
    const record = [e?.first_name, e?.middle_name, e?.last_name].filter((x) => typeof x === "string" && x.trim()).join(" ");
    if (!record) return { result: "failed", verifiedName: null, providerRef, reason: `We couldn't find that ${type.toUpperCase()}. Check the 11 digits and try again.` };
    if (this.o.sandbox) return { result: "verified", verifiedName: nameOnAccount.trim(), providerRef };
    if (!sameName(nameOnAccount, record)) {
      return { result: "failed", verifiedName: null, providerRef,
        reason: `The name on this ${type.toUpperCase()} isn't the name on your NosHen account. Use your own ${type.toUpperCase()}, with your first and last name as they are on it.` };
    }
    return { result: "verified", verifiedName: titleCase(record), providerRef };
  }
}

/** When ID checks are switched on but not set up (no keys): every check stops with a message, never passes. */
export class UnconfiguredIdProvider implements IdProvider {
  readonly name = "unconfigured";
  async check(): Promise<IdCheckResult> {
    throw new DealError("id_unavailable", "The ID check isn't available just now. Try again in a little while.", 503);
  }
}
