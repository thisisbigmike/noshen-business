import { coinAmount, networkOf } from "@noshen/shared/payments";
import { naira } from "@noshen/shared/money";
import { DealError, N, nowOf, type Deps } from "./core";
import { randomId, toHex } from "./crypto";
import { inTx, many, one, type Db } from "./db";
import { dealsFor } from "./queries";
import { depositAddresses, walletBalances } from "./wallets";

/**
 * The NosHen assistant (the Telegram bot) acting for a person. A chat is tied to an account once the person opens a
 * one-time link sent in the chat and confirms it, signed in to NosHen. The assistant only reaches NosHen through a
 * narrow API with its own key, and every rule is checked here, on NosHen's side: nothing the assistant is told, by a
 * person or by text in a listing, can get round them. Staff can unlink a chat, stop the assistant for one person, or
 * switch it off for everyone.
 */

export type AgentChannel = "telegram";
export const AGENT_CHANNELS: AgentChannel[] = ["telegram"];
/** How long a link sent in a chat can be used. */
export const LINK_MINUTES = 10;

const sha256 = async (text: string) => toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));

function checkChat(channel: string, externalId: string) {
  if (!AGENT_CHANNELS.includes(channel as AgentChannel)) throw new DealError("channel", "The assistant only works on Telegram for now.");
  if (!/^\d{1,20}$/.test(externalId)) throw new DealError("chat", "That isn't a Telegram user id.");
}

/** A one-time link that ties this chat to whichever NosHen account opens it and confirms. */
export async function startAgentLink(d: Deps, channel: AgentChannel, externalId: string, externalName: string | null) {
  checkChat(channel, externalId);
  const code = randomId(32); // 160 random bits: the link itself is the secret
  const expiresAt = new Date(nowOf(d).getTime() + LINK_MINUTES * 60_000);
  await d.db.query(
    "insert into agent_link_codes (code_hash, channel, external_id, external_name, expires_at) values ($1, $2, $3, $4, $5)",
    [await sha256(code), channel, externalId, externalName?.trim().slice(0, 64) || null, expiresAt],
  );
  return { url: `${d.appUrl}/link/${code}`, expiresAt };
}

/** What a link would connect, or null when it's unknown, already used or out of time. */
export async function agentLinkOffer(d: Deps, code: string): Promise<{ channel: AgentChannel; externalName: string | null } | null> {
  const r = await one<{ channel: AgentChannel; external_name: string | null }>(
    d.db,
    "select channel, external_name from agent_link_codes where code_hash = $1 and used_at is null and expires_at > $2",
    [await sha256(code), nowOf(d)],
  );
  return r ? { channel: r.channel, externalName: r.external_name } : null;
}

/** Ties the chat behind a link to this account. Linking a chat again moves it to the new account. */
export async function confirmAgentLink(d: Deps, userId: string, code: string): Promise<{ linkId: string }> {
  const hash = await sha256(code);
  return inTx(d.db, { type: "system" }, async (tx) => {
    const c = await one<{ channel: AgentChannel; external_id: string; external_name: string | null; expires_at: Date; used_at: Date | null }>(
      tx.db, "select channel, external_id, external_name, expires_at, used_at from agent_link_codes where code_hash = $1 for update", [hash]);
    if (!c || c.used_at || new Date(c.expires_at) <= nowOf(d)) {
      throw new DealError("link", "This link has expired or was already used. Send /link to the NosHen assistant for a new one.", 410);
    }
    await tx.db.query(
      "update agent_links set revoked_at = now(), revoked_by = 'relinked' where channel = $1 and external_id = $2 and revoked_at is null",
      [c.channel, c.external_id],
    );
    const link = await one<{ id: string }>(
      tx.db, "insert into agent_links (user_id, channel, external_id, external_name) values ($1, $2, $3, $4) returning id",
      [userId, c.channel, c.external_id, c.external_name],
    );
    await tx.db.query("update agent_link_codes set used_at = now() where code_hash = $1", [hash]);
    return { linkId: link!.id };
  });
}

/** The chats linked to a person's account, newest first. */
export async function agentLinksOf(db: Db, userId: string) {
  return many<{ id: string; channel: AgentChannel; external_name: string | null; created_at: Date }>(
    db, "select id, channel, external_name, created_at from agent_links where user_id = $1 and revoked_at is null order by created_at desc", [userId]);
}

/** The person unlinks one of their chats, from their account. */
export async function unlinkAgent(d: Deps, userId: string, linkId: string) {
  const r = await d.db.query(
    "update agent_links set revoked_at = now(), revoked_by = 'user' where id = $1 and user_id = $2 and revoked_at is null", [linkId, userId]);
  if (!r.rowCount) throw new DealError("link", "That chat isn't linked to your account.", 404);
}

/** The chat unlinks itself (the person sent /unlink there). True if it was linked. */
export async function unlinkChat(d: Deps, channel: AgentChannel, externalId: string): Promise<boolean> {
  checkChat(channel, externalId);
  const r = await d.db.query(
    "update agent_links set revoked_at = now(), revoked_by = 'user' where channel = $1 and external_id = $2 and revoked_at is null", [channel, externalId]);
  return (r.rowCount ?? 0) > 0;
}

export interface AgentPerson {
  linkId: string;
  userId: string;
  name: string | null;
  /** Whether the assistant may act for them right now; `why` says what's stopping it. */
  allowed: boolean;
  why?: string;
}

/** Who a chat acts for, if it's linked, and whether the assistant may act for them now. */
export async function agentPerson(d: Deps, channel: AgentChannel, externalId: string): Promise<AgentPerson | null> {
  checkChat(channel, externalId);
  const r = await one<{ id: string; user_id: string; full_name: string | null; status: string; agent_blocked_at: Date | null }>(
    d.db,
    `select l.id, l.user_id, u.full_name, u.status, u.agent_blocked_at from agent_links l join users u on u.id = l.user_id
     where l.channel = $1 and l.external_id = $2 and l.revoked_at is null`,
    [channel, externalId],
  );
  if (!r) return null;
  const why = !(await agentEnabled(d.db)) ? "The NosHen assistant is switched off for now."
    : r.agent_blocked_at ? "NosHen has stopped the assistant acting for this account. Contact NosHen support."
    : r.status !== "active" ? "This NosHen account is paused. Contact NosHen support."
    : undefined;
  return { linkId: r.id, userId: r.user_id, name: r.full_name, allowed: !why, why };
}

/** Whether the assistant may act for anyone. Read fresh, not from the settings cache, so switching it off works at once. */
export async function agentEnabled(db: Db): Promise<boolean> {
  const r = await one<{ value: unknown }>(db, "select value from settings where key = 'agent_enabled'");
  return r?.value !== false;
}

/** Notes what the assistant asked for, for staff to see. */
export async function logAgentRequest(db: Db, linkId: string, action: string, ok: boolean) {
  await db.query("insert into agent_requests (link_id, action, ok) values ($1, $2, $3)", [linkId, action.slice(0, 40), ok]);
}

// ---------------------------------------------------------------------------
// What the assistant can look up for a linked person

/** Their wallet: what they hold, and where to send coin. Opening it the first time makes their addresses. */
export async function agentWallet(d: Deps, userId: string) {
  if (!d.wallets) return { setUp: false, balances: [], addresses: [] };
  const [balances, addresses] = await Promise.all([walletBalances(d, userId), depositAddresses(d, userId)]);
  return {
    setUp: true,
    balances: balances.map((b) => ({ amount: coinAmount(b.micro, b.coin), network: networkOf(b.network).name })),
    addresses: addresses.map((a) => ({ network: networkOf(a.network).name, coins: a.coins.map((c) => c.toUpperCase()), address: a.address })),
  };
}

/** Their latest deals, as buyer or seller, with where each one stands. */
export async function agentDeals(d: Deps, userId: string, limit = 10) {
  const deals = await dealsFor(d.db, userId);
  return deals.slice(0, limit).map((x) => ({
    title: x.title,
    as: x.role,
    with: x.other,
    state: x.state,
    amount: naira(N(x.role === "buyer" ? x.amount_due_kobo : x.seller_share_kobo)),
    link: `${d.appUrl}/d/${x.id}`,
  }));
}

// ---------------------------------------------------------------------------
// For staff

/** The assistant across NosHen: whether it's on, how many chats are linked, and how busy it was today. */
export async function agentOverview(db: Db) {
  const r = await one<{ links: string; people: string; requests: string; refused: string }>(db,
    `select (select count(*) from agent_links where revoked_at is null) as links,
            (select count(distinct user_id) from agent_links where revoked_at is null) as people,
            (select count(*) from agent_requests where at > now() - interval '24 hours') as requests,
            (select count(*) from agent_requests where at > now() - interval '24 hours' and not ok) as refused`);
  return { enabled: await agentEnabled(db), links: N(r?.links), people: N(r?.people), requests24h: N(r?.requests), refused24h: N(r?.refused) };
}

/** One person's assistant: their linked chats, whether staff stopped it, and what it asked for lately. */
export async function staffAgentView(db: Db, userId: string) {
  const [links, blocked, requests] = await Promise.all([
    agentLinksOf(db, userId),
    one<{ agent_blocked_at: Date | null }>(db, "select agent_blocked_at from users where id = $1", [userId]),
    many<{ action: string; ok: boolean; at: Date; external_name: string | null }>(db,
      `select r.action, r.ok, r.at, l.external_name from agent_requests r join agent_links l on l.id = r.link_id
       where l.user_id = $1 order by r.at desc limit 10`, [userId]),
  ]);
  return { links, blockedAt: blocked?.agent_blocked_at ?? null, requests };
}
