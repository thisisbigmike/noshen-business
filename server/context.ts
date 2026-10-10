import { env } from "cloudflare:workers";
import { withDb, type Db } from "./db";
import type { Deps } from "./engine/core";
import { FakePartner } from "./partner/fake";
import type { PaymentsPartner, PartnerEvent } from "./partner/types";
import { ConsoleEmail, type EmailSender } from "./email";
import { FakeIdProvider } from "./idcheck";

/** Deal timers run as Cloudflare Workflows: one instance per deadline, sleeping until it's due. */
export const workflowTimers: Deps["timers"] = {
  async schedule(t) {
    const id = t.kind === "partner_event" ? `pe-${t.event!.id}`.slice(0, 100) : `${t.kind}-${t.dealId}-${t.at.getTime()}`.slice(0, 100);
    try {
      await env.DEAL_TIMERS.create({ id, params: { kind: t.kind, dealId: t.dealId, at: t.at.toISOString(), event: t.event } });
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
  throw new Error(`Payment partner "${env.PARTNER}" isn't set up yet. See server/partner/.`);
}

export function mailFor(): EmailSender {
  if (env.EMAIL === "console") return new ConsoleEmail();
  throw new Error(`Email provider "${env.EMAIL}" isn't set up yet. See server/email.ts.`);
}

export function depsFor(db: Db, mail: EmailSender = mailFor()): Deps {
  return {
    db,
    partner: partnerFor(),
    mail,
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

export const isDev = () => env.PARTNER === "fake";
