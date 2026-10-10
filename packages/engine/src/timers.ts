import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { withApp } from "./context";
import { sweep } from "./sweep";
import { handlePartnerEvent } from "./deals";
import type { PartnerEvent } from "./partner/types";
import type { TimerKind } from "./core";

interface TimerParams {
  kind: TimerKind;
  dealId?: string;
  at: string;
  event?: PartnerEvent;
}

/**
 * One instance per deal deadline. It sleeps until the deadline, then asks the engine to act.
 * The engine re-checks the deal under a lock, so a late, repeated or overtaken timer does nothing.
 * Both sites export this class: each runs the timers its own actions set.
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
