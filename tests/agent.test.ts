import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Network } from "@noshen/shared/payments";
import type { WalletProvider } from "@noshen/engine/partner/types";
import {
  agentDeals, agentLinkOffer, agentLinksOf, agentOverview, agentPerson, agentWallet, confirmAgentLink, logAgentRequest, staffAgentView,
  startAgentLink, unlinkAgent, unlinkChat,
} from "@noshen/engine/agent";
import { setAgentBlocked, setAgentEnabled, staffUnlinkAgent, type StaffActor } from "@noshen/engine/staff";
import { requestDeal } from "@noshen/engine/deals";
import { DealError } from "@noshen/engine/core";
import { world, person, verifiedSeller, liveListing, type TestWorld } from "./helpers";

let w: TestWorld;
let admin: StaffActor;
let reviewer: StaffActor;
let chatSeq = 700_000_000 + Math.floor(Math.random() * 90_000_000);
const newChat = () => String(chatSeq++);

beforeAll(async () => {
  w = await world();
  const staff = async (role: "admin" | "reviewer") =>
    ({ id: (await w.db.query("insert into staff (email, name, role) values ($1, 'Staff', $2) returning id", [`${randomUUID()}@noshen.test`, role])).rows[0].id, role });
  admin = await staff("admin");
  reviewer = await staff("reviewer");
});
afterAll(async () => {
  await setAgentEnabled(w.d, admin, true, "leave it on for the other tests").catch(() => {});
  await w.db.end();
});

const codeOf = (url: string) => url.split("/link/")[1];
const refused = async (p: Promise<unknown>, code: string) => {
  const e = await p.then(() => null, (x) => x);
  expect(e).toBeInstanceOf(DealError);
  expect((e as DealError).code).toBe(code);
};

/** A chat linked to a fresh account. */
async function linked(name: string) {
  const userId = await person(w, name);
  const chat = newChat();
  const { url } = await startAgentLink(w.d, "telegram", chat, `@${name.split(" ")[0].toLowerCase()}`);
  await confirmAgentLink(w.d, userId, codeOf(url));
  return { userId, chat };
}

describe("linking a chat", () => {
  it("links with a one-time code that only the link carries", async () => {
    const me = await person(w, "Ngozi Eke");
    const chat = newChat();
    const { url, expiresAt } = await startAgentLink(w.d, "telegram", chat, "@ngozi");
    expect(url).toMatch(/^http:\/\/test\/link\/[A-Z2-9]{32}$/);
    expect(expiresAt.getTime() - w.clock.now.getTime()).toBe(10 * 60_000);
    // The database keeps only a hash of the code.
    expect((await w.db.query("select 1 from agent_link_codes where code_hash = $1", [codeOf(url)])).rowCount).toBe(0);
    expect(await agentLinkOffer(w.d, codeOf(url))).toEqual({ channel: "telegram", externalName: "@ngozi" });
    expect(await agentPerson(w.d, "telegram", chat)).toBeNull();

    await confirmAgentLink(w.d, me, codeOf(url));
    expect(await agentPerson(w.d, "telegram", chat)).toMatchObject({ userId: me, allowed: true });
    expect((await agentLinksOf(w.db, me)).map((l) => l.external_name)).toEqual(["@ngozi"]);
    // Used once, it's gone.
    expect(await agentLinkOffer(w.d, codeOf(url))).toBeNull();
    await refused(confirmAgentLink(w.d, me, codeOf(url)), "link");
  });

  it("refuses a code that ran out of time, or never existed", async () => {
    const me = await person(w, "Obi Nnaji");
    const { url } = await startAgentLink(w.d, "telegram", newChat(), null);
    w.clock.now = new Date(w.clock.now.getTime() + 11 * 60_000);
    try {
      expect(await agentLinkOffer(w.d, codeOf(url))).toBeNull();
      await refused(confirmAgentLink(w.d, me, codeOf(url)), "link");
    } finally {
      w.clock.now = new Date(w.clock.now.getTime() - 11 * 60_000);
    }
    await refused(confirmAgentLink(w.d, me, "NOTAREALCODE"), "link");
  });

  it("moves a chat to the account that links it last", async () => {
    const { userId: first, chat } = await linked("Paul Udo");
    const second = await person(w, "Queen Udo");
    const { url } = await startAgentLink(w.d, "telegram", chat, "@paul");
    await confirmAgentLink(w.d, second, codeOf(url));
    expect((await agentPerson(w.d, "telegram", chat))?.userId).toBe(second);
    expect(await agentLinksOf(w.db, first)).toEqual([]);
  });

  it("unlinks from the account or from the chat", async () => {
    const a = await linked("Rita Ama");
    const link = (await agentLinksOf(w.db, a.userId))[0];
    await refused(unlinkAgent(w.d, (await person(w, "Someone Else")), link.id), "link"); // not theirs
    await unlinkAgent(w.d, a.userId, link.id);
    expect(await agentPerson(w.d, "telegram", a.chat)).toBeNull();

    const b = await linked("Sade Oke");
    expect(await unlinkChat(w.d, "telegram", b.chat)).toBe(true);
    expect(await unlinkChat(w.d, "telegram", b.chat)).toBe(false);
    expect(await agentPerson(w.d, "telegram", b.chat)).toBeNull();
  });

  it("takes only Telegram user ids", async () => {
    await refused(startAgentLink(w.d, "telegram", "not-a-number", null), "chat");
    await refused(startAgentLink(w.d, "whatsapp" as never, "123", null), "channel");
  });
});

describe("what the assistant can look up", () => {
  it("shows the wallet once wallets are set up, making the addresses the first time", async () => {
    const { userId } = await linked("Tobi Ade");
    expect(await agentWallet(w.d, userId)).toEqual({ setUp: false, balances: [], addresses: [] });
    const wallets: WalletProvider = {
      name: "test-wallets",
      networks: () => ["solana", "base", "bsc"] as Network[],
      createAddress: async (n) => ({ providerRef: randomUUID(), address: n === "solana" ? randomBytes(16).toString("hex") : `0x${randomBytes(20).toString("hex")}` }),
      withdraw: async () => { throw new Error("not in this test"); },
      screen: async () => ({ ok: true }),
    };
    w.d.wallets = wallets;
    try {
      const v = await agentWallet(w.d, userId);
      expect(v.setUp).toBe(true);
      expect(v.balances).toEqual([]);
      expect(v.addresses.map((a) => [a.network, a.coins])).toEqual([["Solana", ["USDC", "USDT"]], ["Base", ["USDC"]], ["BNB Smart Chain", ["USDT", "USDC"]]]);
    } finally {
      w.d.wallets = undefined;
    }
  });

  it("lists the person's deals with where each one stands", async () => {
    const { userId: buyer } = await linked("Uche Eze");
    const seller = await verifiedSeller(w, "Victor Bassey");
    const listing = await liveListing(w, seller, 150_000, "PlayStation 5");
    await requestDeal(w.d, buyer, { listingId: listing, handover: "meetup" });
    const deals = await agentDeals(w.d, buyer);
    expect(deals).toHaveLength(1);
    expect(deals[0]).toMatchObject({ title: "PlayStation 5", as: "buyer", state: "requested" });
    expect(deals[0].link).toMatch(/^http:\/\/test\/d\//);
  });
});

describe("staff controls", () => {
  it("stops the assistant for one person, and tells them", async () => {
    const { userId, chat } = await linked("Wale Adisa");
    await refused(setAgentBlocked(w.d, reviewer, userId, true, "x"), "reason");
    await setAgentBlocked(w.d, reviewer, userId, true, "Reported for spamming lookups");
    expect(await agentPerson(w.d, "telegram", chat)).toMatchObject({ allowed: false, why: expect.stringMatching(/stopped the assistant/) });
    await refused(setAgentBlocked(w.d, reviewer, userId, true, "again, by mistake"), "state");
    const told = await w.db.query("select template from notifications where user_id = $1 order by id", [userId]);
    expect(told.rows.map((r) => r.template)).toContain("assistant_blocked");
    await setAgentBlocked(w.d, reviewer, userId, false, "Checked: it was a mistake");
    expect((await agentPerson(w.d, "telegram", chat))?.allowed).toBe(true);
    const actions = await w.db.query("select action from staff_actions where target_id = $1 order by id", [userId]);
    expect(actions.rows.map((r) => r.action)).toEqual(["block_assistant", "unblock_assistant"]);
  });

  it("unlinks a chat, and shows staff what it asked for", async () => {
    const { userId, chat } = await linked("Yemi Alade");
    const p = (await agentPerson(w.d, "telegram", chat))!;
    await logAgentRequest(w.db, p.linkId, "wallet", true);
    await logAgentRequest(w.db, p.linkId, "deals", false);
    const view = await staffAgentView(w.db, userId);
    expect(view.links).toHaveLength(1);
    expect(view.requests.map((r) => [r.action, r.ok])).toEqual([["deals", false], ["wallet", true]]);
    await staffUnlinkAgent(w.d, reviewer, view.links[0].id, "Linked from a stolen phone");
    expect(await agentPerson(w.d, "telegram", chat)).toBeNull();
    await refused(staffUnlinkAgent(w.d, reviewer, view.links[0].id, "already gone"), "not_found");
  });

  it("switches the assistant off for everyone, admins only, at once", async () => {
    const { chat } = await linked("Zainab Musa");
    await refused(setAgentEnabled(w.d, reviewer, false, "Trying as a reviewer"), "forbidden");
    await setAgentEnabled(w.d, admin, false, "Pausing while we check a bug");
    expect(await agentPerson(w.d, "telegram", chat)).toMatchObject({ allowed: false, why: expect.stringMatching(/switched off/) });
    expect((await agentOverview(w.db)).enabled).toBe(false);
    await setAgentEnabled(w.d, admin, true, "Bug fixed");
    expect((await agentPerson(w.d, "telegram", chat))?.allowed).toBe(true);
    const o = await agentOverview(w.db);
    expect(o.enabled).toBe(true);
    expect(o.links).toBeGreaterThan(0);
  });
});
