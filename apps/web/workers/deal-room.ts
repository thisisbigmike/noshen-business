import { DurableObject } from "cloudflare:workers";

type Who = { userId: string; role: "buyer" | "seller" };
export type RoomEvent = { type: "message" | "deal" };

/**
 * One live room per deal, holding the WebSockets of the buyer's and seller's open deal pages. When something
 * happens in the deal (a message, a new state), the Worker tells the room and the room tells every open page,
 * which then reloads the deal through the normal, signed-in loader: nothing private travels through here.
 * It also passes on "typing…" and who's on the page now.
 *
 * Uses WebSocket hibernation: an idle room costs nothing and wakes when a message or event arrives. Pings from
 * the page are answered without waking it.
 */
export class DealRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** A page joins the room. The Worker has already checked who they are and that the deal is theirs. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const who: Who = { userId: request.headers.get("x-user") ?? "", role: request.headers.get("x-role") === "seller" ? "seller" : "buyer" };
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [who.userId]);
    server.serializeAttachment(who);
    this.presence();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Something changed in the deal: every open page reloads it. */
  async changed(event: RoomEvent) {
    this.send(event);
  }

  /** Whether this person has the deal open right now (so a new message needn't buzz their phone). */
  async watching(userId: string) {
    return this.ctx.getWebSockets(userId).length > 0;
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== "string" || data.length > 200) return;
    let msg: { type?: string };
    try { msg = JSON.parse(data); } catch { return; }
    const who = ws.deserializeAttachment() as Who | null;
    if (msg.type === "typing" && who) this.send({ type: "typing", role: who.role }, ws);
  }

  async webSocketClose(ws: WebSocket) {
    this.presence(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.presence(ws);
  }

  /** Tells every page who has the deal open (leaving out a socket that's just closed). */
  private presence(gone?: WebSocket) {
    const roles = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === gone) continue;
      const who = ws.deserializeAttachment() as Who | null;
      if (who) roles.add(who.role);
    }
    this.send({ type: "presence", online: [...roles] }, undefined, gone);
  }

  private send(event: object, except?: WebSocket, gone?: WebSocket) {
    const text = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || ws === gone) continue;
      try { ws.send(text); } catch { /* closing */ }
    }
  }
}
