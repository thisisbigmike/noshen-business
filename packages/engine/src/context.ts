import { env } from "cloudflare:workers";
import { withDb, type Db } from "./db";
import type { Deps, LiveRooms } from "./core";
import { FakePartner } from "./partner/fake";
import { FakeCryptoPartner } from "./partner/fake-crypto";
import type { CryptoPartner, PaymentsPartner, PartnerEvent } from "./partner/types";
import { ConsoleEmail, NoEmail, type EmailSender } from "./email";
import { FakeIdProvider } from "./idcheck";
import type { PushConfig } from "./push";
import { flushStaffAlerts } from "./staff-alerts";

/** Deal timers run as Cloudflare Workflows: one instance per deadline, sleeping until it's due. */
export const workflowTimers: Deps["timers"] = {
  async schedule(t) {
    const id = t.kind === "partner_event" ? `pe-${t.event!.id}`.slice(0, 100) : `${t.kind}-${t.dealId}-${t.at.getTime()}`.slice(0, 100);
    try {
      await env.DEAL_TIMERS.create({ id, params: { kind: t.kind, dealId: t.dealId, at: t.at.toISOString(), event: t.event, source: t.source } });
    } catch (e) {
      // An instance with this id already exists: the timer is already set.
      if (!String(e).includes("already")) console.error("could not schedule timer", t.kind, e);
    }
  },
};

export function partnerFor(): PaymentsPartner {
  if (env.PARTNER === "fake") {
    return new FakePartner(env.FAKE_PARTNER_SECRET, env.PARTNER_BANK_NAME, async (event: PartnerEvent) =>
      workflowTimers.schedule({ kind: "partner_event", at: new Date(Date.now() + 4000), event }));
  }
  throw new Error(`Payment partner "${env.PARTNER}" isn't set up yet. See packages/engine/src/partner/.`);
}

/**
 * The crypto partner for USDT payments. The pretend one comes with pretend bank payments; a real one is added
 * here once it's chosen (and cleared by the lawyer). Until then, a site with real payments offers bank transfer only.
 */
export function cryptoFor(): CryptoPartner | undefined {
  if (env.PARTNER === "fake") {
    return new FakeCryptoPartner(env.FAKE_PARTNER_SECRET, async (event: PartnerEvent) =>
      workflowTimers.schedule({ kind: "partner_event", at: new Date(Date.now() + 4000), event, source: "crypto" }));
  }
  return undefined;
}

/**
 * True only in the development server on this computer. Test conveniences (codes on screen, the timer sweep
 * button) never run anywhere else: a production build is never "local", whatever its settings say.
 */
export const isLocal = () => import.meta.env.DEV && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(env.APP_URL);

export function mailFor(): EmailSender {
  if (env.EMAIL === "console") {
    // Prints every email and shows sign-in codes on screen, so it must never run on a real address.
    if (!isLocal()) throw new Error('EMAIL "console" only works on a local address. Use "none" (Google sign-in only) or a real provider.');
    return new ConsoleEmail();
  }
  if (env.EMAIL === "none") return new NoEmail();
  throw new Error(`Email provider "${env.EMAIL}" isn't set up yet. See packages/engine/src/email.ts.`);
}

/** Keys for phone and computer notifications, when they're set (VAPID_PUBLIC_KEY, and the secret VAPID_PRIVATE_JWK). */
export function pushFor(): PushConfig | undefined {
  const e = env as unknown as { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_JWK?: string; APP_URL: string };
  if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_JWK) return undefined;
  return { publicKey: e.VAPID_PUBLIC_KEY, privateJwk: e.VAPID_PRIVATE_JWK, subject: e.APP_URL.startsWith("https:") ? e.APP_URL : "https://noshen-web.usenoshen.workers.dev" };
}

/**
 * The live deal rooms (a Durable Object per deal, see apps/web/workers/deal-room.ts). The customer site has them;
 * the staff site reaches the same rooms in production. Without the binding, pages fall back to checking regularly.
 */
export function liveFor(): LiveRooms | undefined {
  const ns = (env as unknown as { DEAL_ROOMS?: DurableObjectNamespace }).DEAL_ROOMS;
  if (!ns) return undefined;
  const room = (dealId: string) => ns.get(ns.idFromName(dealId)) as unknown as { changed(e: { type: string }): Promise<void>; watching(u: string): Promise<boolean> };
  return {
    changed: (dealId, kind) => room(dealId).changed({ type: kind }),
    watching: (dealId, userId) => room(dealId).watching(userId),
  };
}

/**
 * How staff alerts leave the outbox. The staff site sends them itself; the customer site asks the staff site to,
 * through a service binding (production), since its own database login can't read staff devices. Without either
 * (local customer site), the staff site's one-minute check sends them.
 */
export function staffAlertsFor(): Deps["staffAlerts"] {
  const e = env as unknown as { ADMIN_URL?: string; STAFF_SITE?: Fetcher };
  if (e.STAFF_SITE) return () => e.STAFF_SITE!.fetch("https://staff/internal/staff-alerts/flush", { method: "POST" });
  if (e.ADMIN_URL) return (d) => flushStaffAlerts(d);
  return undefined;
}

export function depsFor(db: Db, mail: EmailSender = mailFor()): Deps {
  return {
    db,
    partner: partnerFor(),
    crypto: cryptoFor(),
    mail,
    push: pushFor(),
    live: liveFor(),
    staffAlerts: staffAlertsFor(),
    ids: new FakeIdProvider(),
    timers: workflowTimers,
    secrets: { releaseCode: env.RELEASE_CODE_SECRET, fieldKey: env.FIELD_KEY },
    appUrl: env.APP_URL,
  };
}

/** Runs fn with a database connection (through Hyperdrive) and the engine's dependencies. */
export function withApp<T>(fn: (d: Deps) => Promise<T>, mail?: EmailSender): Promise<T> {
  return withDb(env.HYPERDRIVE.connectionString, (db) => fn(depsFor(db, mail)));
}

/** Pretend payments and checks (the fake partner): on this computer, or on a public demo. */
export const isDev = () => env.PARTNER === "fake";
/** A public demo: pretend payments on a real address. Shows the demo notice and keeps the site out of search. */
export const isDemo = () => isDev() && !isLocal();
