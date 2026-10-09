import { createRequestHandler } from "react-router";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { api } from "../server/api";
import { withApp } from "../server/context";
import { sweep } from "../server/engine/sweep";
import { handlePartnerEvent } from "../server/engine/deals";
import type { PartnerEvent } from "../server/partner/types";
import type { TimerKind } from "../server/engine/core";

const pages = createRequestHandler(() => import("virtual:react-router/server-build"), import.meta.env.MODE);

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/") || pathname.startsWith("/photos/")) return api.fetch(request, env, ctx);
    return pages(request);
  },

  // Every 15 minutes: act on any deadline whose timer didn't fire (TRD: stuck-deal watch).
  async scheduled(_event, _env, ctx) {
    ctx.waitUntil(withApp((d) => sweep(d)).then((done) => { if (done.length) console.log("sweep", done); }));
  },
} satisfies ExportedHandler<Env>;

interface TimerParams {
  kind: TimerKind;
  dealId?: string;
  at: string;
  event?: PartnerEvent;
}

/**
 * One instance per deal deadline. It sleeps until the deadline, then asks the engine to act.
 * The engine re-checks the deal under a lock, so a late, repeated or overtaken timer does nothing.
 */
export class DealTimers extends WorkflowEntrypoint<Env, TimerParams> {
  async run(event: WorkflowEvent<TimerParams>, step: WorkflowStep) {
    const p = event.payload;
    await step.sleepUntil("wait until the deadline", new Date(p.at));
    return step.do("act on the deadline", { retries: { limit: 5, delay: "30 seconds", backoff: "exponential" } }, async () => {
      if (p.kind === "partner_event" && p.event) return withApp((d) => handlePartnerEvent(d, p.event!));
      return (await withApp((d) => sweep(d, p.dealId))).join("; ");
    });
  }
}
