import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Network } from "@noshen/shared/payments";
import { Blockradar, decimalToMicro, microToDecimal, type WalletEvent } from "@noshen/engine/partner/blockradar";
import { WalletProviderError, WebhookSignatureError, type WalletProvider } from "@noshen/engine/partner/types";
import { depositAddresses, handleWalletEvent, requestWithdrawal, walletActivity, walletBalances, DAILY_WITHDRAWAL_MICRO } from "@noshen/engine/wallets";
import { DealError } from "@noshen/engine/core";
import { world, person, verifiedSeller, type TestWorld } from "./helpers";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const solAddress = () => Array.from(randomBytes(44), (b) => B58[b % B58.length]).join("");
const evmAddress = () => `0x${randomBytes(20).toString("hex")}`;

/** Stands in for Blockradar: hands out addresses, records what it was asked to send, and can refuse or go quiet. */
class TestWallets implements WalletProvider {
  readonly name = "test-wallets";
  made: Network[] = [];
  sent: { network: Network; coin: string; address: string; amountMicro: number; reference: string }[] = [];
  answer: "ok" | "refuse" | "silent" = "ok";
  blocked = new Set<string>();
  networks(): Network[] { return ["solana", "base", "bsc"]; }
  async createAddress(network: Network) {
    this.made.push(network);
    return { providerRef: randomUUID(), address: network === "solana" ? solAddress() : evmAddress() };
  }
  async withdraw(network: Network, w: { coin: string; address: string; amountMicro: number; reference: string }) {
    if (this.answer === "refuse") throw new WalletProviderError("insufficient gas", true);
    if (this.answer === "silent") throw new WalletProviderError("no answer", false);
    this.sent.push({ network, ...w });
    return { providerRef: randomUUID(), hash: `0x${randomBytes(32).toString("hex")}` };
  }
  async screen(_n: Network, address: string) { return { ok: !this.blocked.has(address) }; }
}

const deposit = (network: Network, to: string, symbol: string, amount: string, extra: Record<string, unknown> = {}): WalletEvent => ({
  network,
  event: "deposit.success",
  data: {
    id: randomUUID(), hash: `0x${randomBytes(32).toString("hex")}`, amount, asset: { symbol }, address: { address: to },
    senderAddress: evmAddress(), createdAt: new Date().toISOString(), amlScreening: { provider: "ofac", status: "success" }, ...extra,
  },
});

let w: TestWorld;
let wallets: TestWallets;
beforeAll(async () => {
  w = await world();
  wallets = new TestWallets();
  w.d.wallets = wallets;
});
afterAll(async () => { await w.db.end(); });

const balance = async (userId: string, coin: string, network: string) =>
  (await walletBalances(w.d, userId)).find((b) => b.coin === coin && b.network === network)?.micro ?? 0;

describe("amounts", () => {
  it("turns Blockradar's decimal amounts into millionths and back, never rounding up", () => {
    expect(decimalToMicro("10.0")).toBe(10_000_000);
    expect(decimalToMicro("0.5")).toBe(500_000);
    expect(decimalToMicro("12")).toBe(12_000_000);
    expect(decimalToMicro("1.2345679")).toBe(1_234_567);
    expect(decimalToMicro("25.000000000000000001")).toBe(25_000_000); // BNB's tokens have 18 decimals
    expect(() => decimalToMicro("-1")).toThrow();
    expect(() => decimalToMicro("1e6")).toThrow();
    expect(microToDecimal(12_500_000)).toBe("12.5");
    expect(microToDecimal(10_000_000)).toBe("10");
    expect(microToDecimal(1)).toBe("0.000001");
  });
});

describe("Blockradar", () => {
  const cfg = { wallets: { base: { walletId: "w-base", apiKey: "key-base" }, bsc: { walletId: "w-bsc", apiKey: "key-bsc" } } };
  const sign = (key: string, raw: string) => createHmac("sha512", key).update(raw).digest("hex");

  it("accepts a webhook signed by a master wallet's key, and says which network sent it", async () => {
    const br = new Blockradar(cfg);
    const raw = JSON.stringify({ event: "deposit.success", data: { id: "t1", amount: "5", wallet: { id: "w-bsc" } } });
    const ev = await br.verifyWebhook(raw, sign("key-bsc", raw));
    expect(ev.network).toBe("bsc");
    expect(ev.event).toBe("deposit.success");
    expect(ev.data.id).toBe("t1");
    // The same JSON with other spacing still checks out, as Blockradar's own examples re-serialise the body.
    const spaced = JSON.stringify(JSON.parse(raw), null, 2);
    await expect(br.verifyWebhook(spaced, sign("key-bsc", raw))).resolves.toMatchObject({ network: "bsc" });
  });

  it("refuses a webhook that's unsigned, tampered with, or signed by one wallet about another", async () => {
    const br = new Blockradar(cfg);
    const raw = JSON.stringify({ event: "deposit.success", data: { id: "t1", amount: "5", wallet: { id: "w-bsc" } } });
    await expect(br.verifyWebhook(raw, null)).rejects.toBeInstanceOf(WebhookSignatureError);
    await expect(br.verifyWebhook(raw.replace('"5"', '"5000"'), sign("key-bsc", raw))).rejects.toBeInstanceOf(WebhookSignatureError);
    await expect(br.verifyWebhook(raw, sign("key-other", raw))).rejects.toBeInstanceOf(WebhookSignatureError);
    await expect(br.verifyWebhook(raw, sign("key-base", raw))).rejects.toThrow(/about another wallet/);
  });

  it("calls the API as documented: key per wallet, asset id looked up once, amounts as decimal strings", async () => {
    const calls: { url: string; method: string; key: string | null; body: any }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      const key = new Headers(init.headers).get("x-api-key");
      calls.push({ url, method: init.method ?? "GET", key, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const data = url.endsWith("/assets") ? [{ id: "wa-1", asset: { id: "asset-usdt", symbol: "USDT" } }, { id: "wa-2", asset: { id: "asset-usdc", symbol: "USDC" } }]
        : url.endsWith("/addresses") ? { id: "addr-1", address: "0xabc" }
        : url.includes("/aml/lookup") ? { isBlacklisted: false }
        : { id: "tx-1", hash: "0xhash", status: "PENDING" };
      return new Response(JSON.stringify({ data, statusCode: 200 }), { status: 200 });
    }) as typeof fetch;
    const br = new Blockradar(cfg, fetcher);
    expect(await br.createAddress("base", "NosHen u1", { userId: "u1" })).toEqual({ providerRef: "addr-1", address: "0xabc" });
    expect(await br.withdraw("bsc", { coin: "usdt", address: "0xdef", amountMicro: 12_500_000, reference: "wd-1" })).toEqual({ providerRef: "tx-1", hash: "0xhash" });
    await br.withdraw("bsc", { coin: "usdc", address: "0xdef", amountMicro: 1_000_000, reference: "wd-2" });
    expect(await br.screen("bsc", "0xdef")).toEqual({ ok: true });
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.blockradar.co/v1", "")} ${c.key}`)).toEqual([
      "POST /wallets/w-base/addresses key-base",
      "GET /wallets/w-bsc/assets key-bsc",
      "POST /wallets/w-bsc/withdraw key-bsc",
      "POST /wallets/w-bsc/withdraw key-bsc",
      "GET /aml/lookup?address=0xdef&blockchain=bnb-smart-chain key-bsc",
    ]);
    expect(calls[0].body).toEqual({ name: "NosHen u1", metadata: { userId: "u1" }, showPrivateKey: false });
    expect(calls[2].body).toMatchObject({ assetId: "asset-usdt", address: "0xdef", amount: "12.5", reference: "wd-1" });
    expect(calls[3].body).toMatchObject({ assetId: "asset-usdc", amount: "1" });
  });

  it("tells a refusal (nothing sent) from a lost answer (maybe sent)", async () => {
    const refusing = new Blockradar(cfg, (async () => new Response(JSON.stringify({ message: "Insufficient balance" }), { status: 400 })) as typeof fetch);
    await expect(refusing.createAddress("base", "x", {})).rejects.toMatchObject({ refused: true });
    const broken = new Blockradar(cfg, (async () => new Response("{}", { status: 502 })) as typeof fetch);
    await expect(broken.createAddress("base", "x", {})).rejects.toMatchObject({ refused: false });
    const silent = new Blockradar(cfg, (async () => { throw new Error("timed out"); }) as typeof fetch);
    await expect(silent.createAddress("base", "x", {})).rejects.toMatchObject({ refused: false });
  });
});

describe("NosHen wallets", () => {
  it("gives each person fixed addresses, made once: one on Solana, one shared by Base and BNB", async () => {
    const me = await person(w, "Ada Eze");
    const before = wallets.made.length;
    const first = await depositAddresses(w.d, me);
    const again = await depositAddresses(w.d, me);
    expect(again).toEqual(first);
    expect(wallets.made.length - before).toBe(2);
    const by = Object.fromEntries(first.map((a) => [a.network, a]));
    expect(by.base.address).toBe(by.bsc.address);
    expect(by.solana.address).not.toBe(by.base.address);
    expect(by.base.coins).toEqual(["usdc"]);
    expect(by.bsc.coins).toEqual(["usdt", "usdc"]);
  });

  it("credits a deposit once, however often the provider sends it", async () => {
    const me = await person(w, "Bola Ade");
    const evm = (await depositAddresses(w.d, me)).find((a) => a.network === "bsc")!.address;
    const ev = deposit("bsc", evm.toUpperCase().replace("0X", "0x"), "USDT", "25.5");
    expect(await handleWalletEvent(w.d, ev)).toMatch(/credited 25.50 USDT on BNB Smart Chain/);
    expect(await handleWalletEvent(w.d, ev)).toBe("seen before");
    expect(await balance(me, "usdt", "bsc")).toBe(25_500_000);
    const activity = await walletActivity(w.d, me);
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ kind: "deposit", coin: "usdt", network: "bsc" });
  });

  it("keeps the coin on Base and BNB apart, and USDC apart from USDT", async () => {
    const me = await person(w, "Chidi Okafor");
    const addr = (await depositAddresses(w.d, me)).find((a) => a.network === "base")!.address;
    await handleWalletEvent(w.d, deposit("base", addr, "USDC", "10"));
    await handleWalletEvent(w.d, deposit("bsc", addr, "USDC", "3"));
    await handleWalletEvent(w.d, deposit("bsc", addr, "USDT", "4"));
    expect(await walletBalances(w.d, me)).toEqual([
      { coin: "usdc", network: "base", micro: 10_000_000 },
      { coin: "usdc", network: "bsc", micro: 3_000_000 },
      { coin: "usdt", network: "bsc", micro: 4_000_000 },
    ]);
  });

  it("holds back what it can't credit, and tells staff", async () => {
    const me = await person(w, "Dayo Ojo");
    const addrs = await depositAddresses(w.d, me);
    const base = addrs.find((a) => a.network === "base")!.address;
    const alerts = async () => Number((await w.db.query("select count(*) from staff_alerts where kind = 'wallet_check'")).rows[0].count);
    const before = await alerts();
    expect(await handleWalletEvent(w.d, deposit("base", evmAddress(), "USDC", "5"))).toMatch(/isn't anyone's/);
    expect(await handleWalletEvent(w.d, deposit("base", base, "USDT", "5"))).toMatch(/doesn't take this token/); // no Tether USDT on Base
    expect(await handleWalletEvent(w.d, deposit("solana", addrs.find((a) => a.network === "solana")!.address, "USDG", "5"))).toMatch(/doesn't take this token/);
    expect(await handleWalletEvent(w.d, deposit("base", base, "USDC", "5", { amlScreening: { status: "failed", message: "Address is sanctioned" } }))).toMatch(/sanctions/);
    expect(await walletBalances(w.d, me)).toEqual([]);
    expect(await alerts()).toBe(before + 4);
  });

  it("refuses an unbalanced ledger transaction, and any balance below zero", async () => {
    const me = await person(w, "Efe Ibe");
    const txn = async (lines: [string, string | null, number, number][]) => {
      await w.db.query("begin");
      try {
        const t = (await w.db.query("insert into wallet_transactions (kind) values ('adjustment') returning id")).rows[0].id;
        for (const [account, user, debit, credit] of lines) {
          await w.db.query("insert into wallet_entries (txn_id, account, user_id, coin, network, debit_micro, credit_micro) values ($1, $2, $3, 'usdc', 'base', $4, $5)", [t, account, user, debit, credit]);
        }
        await w.db.query("commit");
      } catch (e) {
        await w.db.query("rollback");
        throw e;
      }
    };
    await expect(txn([["custody", null, 5, 0], ["user_balance", me, 0, 4]])).rejects.toThrow(/unbalanced/);
    await expect(txn([["user_balance", me, 5, 0], ["custody", null, 0, 5]])).rejects.toThrow(/below zero/);
  });

  describe("withdrawals", () => {
    async function funded(name: string, micro = 50_000_000) {
      const me = await verifiedSeller(w, name);
      const addr = (await depositAddresses(w.d, me)).find((a) => a.network === "bsc")!.address;
      await handleWalletEvent(w.d, deposit("bsc", addr, "USDT", microToDecimal(micro)));
      return me;
    }
    const out = (me: string, amountMicro: number, address = evmAddress()) => requestWithdrawal(w.d, me, { coin: "usdt", network: "bsc", address, amountMicro });
    const row = async (id: string) => (await w.db.query("select status, provider_ref, failure_reason from wallet_withdrawals where id = $1", [id])).rows[0];
    const ledger = async (account: string, network = "bsc") =>
      Number((await w.db.query("select coalesce(sum(debit_micro - credit_micro), 0) as n from wallet_entries where account = $1 and network = $2", [account, network])).rows[0].n);

    it("sends from the balance, and settles when the network confirms", async () => {
      wallets.answer = "ok";
      const me = await funded("Femi Lawal");
      const custodyBefore = await ledger("custody");
      const to = evmAddress();
      const { id, status } = await out(me, 20_000_000, to);
      expect(status).toBe("sent");
      expect(wallets.sent.at(-1)).toMatchObject({ network: "bsc", coin: "usdt", address: to, amountMicro: 20_000_000, reference: id });
      expect(await balance(me, "usdt", "bsc")).toBe(30_000_000);
      const providerRef = (await row(id)).provider_ref;
      const done: WalletEvent = { network: "bsc", event: "withdraw.success", data: { id: providerRef, reference: id, hash: "0xdone", status: "SUCCESS" } };
      expect(await handleWalletEvent(w.d, done)).toMatch(/confirmed/);
      expect(await handleWalletEvent(w.d, done)).toBe("seen before");
      expect((await row(id)).status).toBe("succeeded");
      expect(await ledger("custody")).toBe(custodyBefore - 20_000_000);
      expect(await ledger("withdrawals_out")).toBe(0);
    });

    it("puts the coin back when the provider refuses, or the network fails it later", async () => {
      const me = await funded("Gbenga Uche");
      wallets.answer = "refuse";
      const refused = await out(me, 10_000_000);
      expect(refused.status).toBe("failed");
      expect((await row(refused.id)).failure_reason).toMatch(/insufficient gas/);
      expect(await balance(me, "usdt", "bsc")).toBe(50_000_000);

      wallets.answer = "ok";
      const later = await out(me, 10_000_000);
      expect(await balance(me, "usdt", "bsc")).toBe(40_000_000);
      const failed: WalletEvent = { network: "bsc", event: "withdraw.failed", data: { id: randomUUID(), reference: later.id, reason: "reverted" } };
      expect(await handleWalletEvent(w.d, failed)).toMatch(/went back to the balance/);
      expect((await row(later.id)).status).toBe("failed");
      expect(await balance(me, "usdt", "bsc")).toBe(50_000_000);
    });

    it("leaves a withdrawal pending when the provider's answer is lost, and tells staff", async () => {
      const me = await funded("Halima Bello");
      wallets.answer = "silent";
      const { id, status } = await out(me, 5_000_000);
      expect(status).toBe("pending");
      expect((await row(id)).failure_reason).toMatch(/check there before sending again/);
      expect(await balance(me, "usdt", "bsc")).toBe(45_000_000); // not given back: it may have gone out
      wallets.answer = "ok";
    });

    it("refuses what it shouldn't send", async () => {
      const me = await funded("Ike Nwosu");
      const unverified = await person(w, "Jide Ola");
      const refuses = async (p: Promise<unknown>, code: string) => {
        const e = await p.then(() => null, (x) => x);
        expect(e).toBeInstanceOf(DealError);
        expect((e as DealError).code).toBe(code);
      };
      await refuses(out(unverified, 1_000_000), "id");
      await refuses(out(me, 60_000_000), "balance");
      await refuses(out(me, 500_000), "amount");
      await refuses(out(me, 1_000_000, "not-an-address"), "address");
      await refuses(requestWithdrawal(w.d, me, { coin: "usdt", network: "base", address: evmAddress(), amountMicro: 1_000_000 }), "coin");
      const sanctioned = evmAddress();
      wallets.blocked.add(sanctioned);
      await refuses(out(me, 1_000_000, sanctioned), "address");
      expect(await balance(me, "usdt", "bsc")).toBe(50_000_000);
    });

    it("keeps to the daily limit", async () => {
      const me = await funded("Kemi Adeyemi", DAILY_WITHDRAWAL_MICRO + 10_000_000);
      await out(me, DAILY_WITHDRAWAL_MICRO - 1_000_000);
      const e = await out(me, 2_000_000).then(() => null, (x) => x);
      expect((e as DealError).code).toBe("limit");
      expect((await out(me, 1_000_000)).status).toBe("sent");
    });
  });
});
