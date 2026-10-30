import { config } from "./config.js";

/**
 * NosHen's API for the assistant (/api/agent on the NosHen site): linking a chat to a NosHen account, and looking
 * up that person's wallet and deals. Every rule is checked on NosHen's side, so this only asks; it never reaches the
 * database, the wallets or anyone's keys.
 */

/** Who a chat belongs to: on Telegram, the person's user id, in a private chat with the assistant. */
export interface AgentIdentity {
  channel: "telegram";
  externalId: string;
}

const TIMEOUT_MS = 10_000;

interface Answer {
  ok: boolean;
  status: number;
  data: any;
}

async function call(method: "GET" | "POST", path: string, body?: object): Promise<Answer> {
  if (!config.noshenAgentKey) {
    return { ok: false, status: 0, data: { message: "Looking up NosHen accounts isn't set up on this assistant yet (NOSHEN_AGENT_KEY)." } };
  }
  try {
    const res = await fetch(`${config.noshenApiUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: { authorization: `Bearer ${config.noshenAgentKey}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, status: 0, data: { message: "NosHen didn't answer just now. Please try again in a minute." } };
  }
}

/** A one-time link that ties this chat to whichever NosHen account opens it and confirms. */
export const startLink = (who: AgentIdentity, name: string | null) =>
  call("POST", "/api/agent/link", { channel: who.channel, externalId: who.externalId, externalName: name });

export const unlink = (who: AgentIdentity) => call("POST", "/api/agent/unlink", { channel: who.channel, externalId: who.externalId });

/** The linked person's wallet or deals, as a tool result the model can read. */
export async function lookUp(what: "wallet" | "deals", who?: AgentIdentity) {
  if (!who) {
    return { success: false, message: "This only works in a private Telegram chat with the NosHen assistant, once the person links it to their NosHen account by sending /link." };
  }
  const r = await call("GET", `/api/agent/${what}?channel=${who.channel}&externalId=${encodeURIComponent(who.externalId)}`);
  return r.ok ? { success: true, ...r.data } : { success: false, message: r.data?.message ?? `NosHen refused the request (${r.status}).` };
}
