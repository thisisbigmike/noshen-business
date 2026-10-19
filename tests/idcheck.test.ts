import { describe, expect, it } from "vitest";
import { DojahIdProvider, UnconfiguredIdProvider } from "@noshen/engine/idcheck";
import { DealError } from "@noshen/engine/core";

/** A stand-in for Dojah's API: answers with a status and body, and remembers what was asked. */
function dojah(status: number, entity?: Record<string, unknown>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string> });
    return new Response(entity ? JSON.stringify({ entity }) : JSON.stringify({ error: "x" }), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const RECORD = { first_name: "TUNDE", middle_name: "OLUWASEUN", last_name: "BAKARE", date_of_birth: "1990-01-01", phone_number: "08012345678", photo: "base64…" };

describe("Dojah NIN and BVN checks", () => {
  it("verifies a NIN whose name matches the account, keeping only the name", async () => {
    const { f, calls } = dojah(200, RECORD);
    const p = new DojahIdProvider({ appId: "app", secretKey: "secret", sandbox: false, fetch: f });
    const r = await p.check("nin", "12345678901", "Tunde Bakare");
    expect(r).toMatchObject({ result: "verified", verifiedName: "Tunde Oluwaseun Bakare" });
    expect(JSON.stringify(r)).not.toMatch(/1990|0801|base64/);
    expect(calls[0].url).toBe("https://api.dojah.io/api/v1/kyc/nin?nin=12345678901");
    expect(calls[0].headers).toMatchObject({ AppId: "app", Authorization: "secret" });
  });

  it("matches the name in any order, and looks BVNs up on the BVN endpoint", async () => {
    const { f, calls } = dojah(200, RECORD);
    const r = await new DojahIdProvider({ appId: "a", secretKey: "s", sandbox: false, fetch: f }).check("bvn", "22345678901", "bakare tunde");
    expect(r.result).toBe("verified");
    expect(calls[0].url).toBe("https://api.dojah.io/api/v1/kyc/bvn/full?bvn=22345678901");
  });

  it("refuses a number whose name isn't the account's, without saying whose it is", async () => {
    const { f } = dojah(200, RECORD);
    const r = await new DojahIdProvider({ appId: "a", secretKey: "s", sandbox: false, fetch: f }).check("nin", "12345678901", "Ada Okonkwo");
    expect(r).toMatchObject({ result: "failed", verifiedName: null });
    expect(r.reason).not.toMatch(/tunde|bakare|oluwaseun/i);
    // One shared name isn't enough.
    expect((await new DojahIdProvider({ appId: "a", secretKey: "s", sandbox: false, fetch: dojah(200, RECORD).f }).check("nin", "12345678901", "Tunde")).result).toBe("failed");
  });

  it("says a number wasn't found, and checks the digits before asking", async () => {
    const { f, calls } = dojah(404);
    const p = new DojahIdProvider({ appId: "a", secretKey: "s", sandbox: false, fetch: f });
    expect(await p.check("nin", "12345678901", "Tunde Bakare")).toMatchObject({ result: "failed", reason: expect.stringMatching(/couldn't find that NIN/) });
    expect((await p.check("nin", "1234", "Tunde Bakare")).reason).toMatch(/11 digits/);
    expect(calls).toHaveLength(1);
  });

  it("treats NosHen's or Dojah's problems as try-again-later, not as a failed check", async () => {
    for (const status of [401, 402, 424, 429, 500]) {
      const p = new DojahIdProvider({ appId: "a", secretKey: "s", sandbox: false, fetch: dojah(status).f });
      await expect(p.check("nin", "12345678901", "Tunde Bakare")).rejects.toMatchObject({ code: "id_unavailable" });
    }
    const down = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
    await expect(new DojahIdProvider({ appId: "a", secretKey: "s", sandbox: false, fetch: down }).check("nin", "12345678901", "Tunde Bakare")).rejects.toBeInstanceOf(DealError);
    await expect(new UnconfiguredIdProvider().check()).rejects.toMatchObject({ code: "id_unavailable" });
  });

  it("uses Dojah's sandbox, and its made-up people, when set to", async () => {
    const { f, calls } = dojah(200, { first_name: "John", last_name: "Doe" });
    const p = new DojahIdProvider({ appId: "a", secretKey: "s", sandbox: true, fetch: f });
    expect(p.name).toBe("dojah-sandbox");
    expect(await p.check("nin", "70123456789", "Tunde Bakare")).toMatchObject({ result: "verified", verifiedName: "Tunde Bakare" });
    expect(calls[0].url).toBe("https://sandbox.dojah.io/api/v1/kyc/nin?nin=70123456789");
  });
});
