import { Bot, InlineKeyboard } from "grammy";
import type { Api } from "grammy";
import { config } from "../config.js";
import { CommerceAgent, readApprovalReply, type ApprovalDecision } from "../gemini.js";
import { startLink, unlink, type AgentIdentity } from "../noshen-account.js";

// Telegram rejects messages over 4096 characters; this leaves room for formatting tags.
const MESSAGE_LIMIT = 3500;
// How often the reply in progress is edited. Telegram throttles faster edits.
const EDIT_INTERVAL_MS = 1200;
// The typing indicator disappears after about 5 seconds, so it is sent again before then.
const TYPING_INTERVAL_MS = 4500;
const MAX_SESSIONS = 1000;
// An approval request nobody answers is declined after this long, so the conversation can't hang.
const APPROVAL_TIMEOUT_MS = 5 * 60_000;

const TOOL_STATUS: Record<string, string> = {
  search_noshen_help: "📖 Checking NosHen's rules…",
  search_noshen_listings: "🔎 Searching NosHen…",
  search_ebay: "🔎 Searching eBay…",
  my_wallet: "👛 Checking your wallet…",
  my_deals: "📋 Checking your deals…",
  jev_risk_evaluator: "🛡️ Checking the deal for fraud…",
};

// One conversation per Telegram chat, so people never see each other's history.
// The least recently used chat is dropped once there are too many.
const sessions = new Map<number, CommerceAgent>();

// The approval each chat is waiting on, if any. Only the person whose message led to it can answer it.
interface PendingApproval {
  messageId: number;
  userId: number;
  decide: (decision: ApprovalDecision) => void;
}
const pendingApprovals = new Map<number, PendingApproval>();

/**
 * The person a chat belongs to: only a private chat, where the chat is the person. In a group, nobody's account is
 * looked up, whoever asks.
 */
const identityOf = (chat: { id: number; type: string }): AgentIdentity | undefined =>
  chat.type === "private" ? { channel: "telegram", externalId: String(chat.id) } : undefined;

function sessionFor(chatId: number, identity?: AgentIdentity): CommerceAgent {
  const agent = sessions.get(chatId) ?? new CommerceAgent({ identity });
  sessions.delete(chatId);
  sessions.set(chatId, agent);
  if (sessions.size > MAX_SESSIONS) {
    sessions.delete(sessions.keys().next().value!);
  }
  return agent;
}

export async function startTelegramBot() {
  if (!config.telegramToken || config.telegramToken.startsWith("your_")) {
    console.log("[Telegram]: No valid TELEGRAM_BOT_TOKEN provided. Skipping Telegram listener.");
    console.log("Tip: You can create a free bot token via @BotFather on Telegram and put it in apps/agent/.env");
    return;
  }

  const bot = new Bot(config.telegramToken);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "👋 Hello! I am your NosHen Universal Agentic Commerce Assistant.\n\n" +
      "I find items for sale on NosHen and eBay, and answer questions about how NosHen deals work.\n\n" +
      "Tell me what you're looking for! (e.g. 'Find a clean iPhone 13 in Lagos')\n\n" +
      "Send /link to connect your NosHen account: then I can show your wallet and your deals.\n\n" +
      "Send /reset any time to start a fresh conversation."
    );
  });

  bot.command("reset", async (ctx) => {
    pendingApprovals.get(ctx.chat.id)?.decide({ approved: false });
    sessions.delete(ctx.chat.id);
    await ctx.reply("🧹 Fresh start. What are you looking for?");
  });

  // Linking this chat to a NosHen account: a one-time link the person opens, signs in and confirms.
  bot.command("link", async (ctx) => {
    const who = identityOf(ctx.chat);
    if (!who) return void (await ctx.reply("Link your NosHen account in a private chat with me, not in a group."));
    const name = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name ?? null;
    const r = await startLink(who, name);
    if (!r.ok) return void (await ctx.reply(r.data?.message ?? "I couldn't make a link just now. Please try again in a minute."));
    const text = "Open this link, sign in to NosHen and confirm. It works once, for 10 minutes.";
    // Telegram only takes https links on buttons; on a test site the link goes in the message instead.
    await ctx.reply(text, { reply_markup: new InlineKeyboard().url("🔗 Link my NosHen account", r.data.url) })
      .catch(() => ctx.reply(`${text}\n\n${r.data.url}`));
  });

  bot.command("unlink", async (ctx) => {
    const who = identityOf(ctx.chat);
    if (!who) return void (await ctx.reply("Unlink in a private chat with me, not in a group."));
    const r = await unlink(who);
    await ctx.reply(!r.ok ? (r.data?.message ?? "I couldn't do that just now. Please try again in a minute.")
      : r.data?.unlinked ? "Done: this chat isn't linked to your NosHen account any more." : "This chat wasn't linked to a NosHen account.");
  });

  bot.on("message:text", (ctx) => {
    // A typed yes or no answers the approval the chat is waiting on, instead of starting a new message.
    const pending = pendingApprovals.get(ctx.chat.id);
    if (pending && pending.userId === ctx.from.id) {
      pending.decide(readApprovalReply(ctx.message.text));
      return;
    }
    // Not awaited: grammY handles updates one at a time, so waiting here would make every other chat wait too.
    void replyTo(ctx.api, ctx.chat.id, ctx.from.id, ctx.message.text, identityOf(ctx.chat));
  });

  bot.on("callback_query:data", async (ctx) => {
    const pending = pendingApprovals.get(ctx.chat?.id ?? 0);
    const current = pending && pending.messageId === ctx.callbackQuery.message?.message_id && pending.userId === ctx.from.id;
    if (current) pending.decide({ approved: ctx.callbackQuery.data === "approve" });
    await ctx.answerCallbackQuery(current ? undefined : { text: "This request is no longer waiting for an answer." }).catch(() => {});
  });

  bot.catch((err) => console.error("[Telegram Error]:", err.message));

  process.once("SIGINT", () => bot.stop());
  process.once("SIGTERM", () => bot.stop());

  bot.api
    .setMyCommands([
      { command: "start", description: "What I can do" },
      { command: "reset", description: "Start a fresh conversation" },
      { command: "link", description: "Link your NosHen account" },
      { command: "unlink", description: "Unlink your NosHen account" },
    ])
    .catch(() => {});

  await bot.start({
    onStart: (me) => console.log(`[Telegram]: Bot polling started successfully as @${me.username}.`),
  });
}

/** Answers one message, showing the reply as it is written. */
async function replyTo(api: Api, chatId: number, userId: number, text: string, identity?: AgentIdentity) {
  const startedAt = Date.now();
  let waitingForUser = false;
  const sendTyping = () => {
    if (!waitingForUser) api.sendChatAction(chatId, "typing").catch(() => {});
  };
  sendTyping();
  const typingTimer = setInterval(sendTyping, TYPING_INTERVAL_MS);
  let reply = new LiveReply(api, chatId);

  try {
    await sessionFor(chatId, identity).sendMessage(text, {
      onEvent: (event) => {
        if (event.type === "tool") reply.setStatus(TOOL_STATUS[event.name] ?? "⏳ Working on it…");
        else if (event.type === "text") reply.addText(event.text);
        else {
          const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
          const tools = event.tools.length ? `, tools: ${event.tools.join(", ")}` : "";
          console.log(`[Telegram]: chat ${chatId} answered in ${seconds}s, ${event.inputTokens} tokens in, ${event.outputTokens} out${tools}`);
        }
      },
      onApproval: async (action) => {
        // What was written so far stays above the request; the rest of the answer comes after it.
        await reply.finish();
        waitingForUser = true;
        const decision = await askApproval(api, chatId, userId, action);
        waitingForUser = false;
        sendTyping();
        reply = new LiveReply(api, chatId);
        return decision;
      },
    });
    await reply.finish();
  } catch (err: any) {
    await reply.finish(`Sorry, I encountered an error: ${err.message}`);
  } finally {
    clearInterval(typingTimer);
  }
}

/** Shows the action with Approve and Cancel buttons, and waits for the user's answer. */
async function askApproval(api: Api, chatId: number, userId: number, action: string): Promise<ApprovalDecision> {
  const prompt = `🔐 Approve this?\n\n${action}`;
  let messageId: number;
  try {
    const message = await api.sendMessage(chatId, prompt, {
      reply_markup: new InlineKeyboard().text("✅ Approve", "approve").text("❌ Cancel", "reject"),
    });
    messageId = message.message_id;
  } catch {
    return { approved: false };
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => decide({ approved: false }), APPROVAL_TIMEOUT_MS);
    const decide = (decision: ApprovalDecision) => {
      if (pendingApprovals.get(chatId)?.messageId !== messageId) return;
      clearTimeout(timer);
      pendingApprovals.delete(chatId);
      const outcome = decision.approved ? "✅ Approved" : "❌ Not done";
      // Editing the text also removes the buttons.
      api.editMessageText(chatId, messageId, `${prompt}\n\n${outcome}`).catch(() => {});
      resolve(decision);
    };
    pendingApprovals.set(chatId, { messageId, userId, decide });
  });
}

/** A reply that appears while it streams in, then is replaced by the formatted text. */
class LiveReply {
  private messageId: number | undefined;
  private text = "";
  private status = "";
  private shown = "";
  private inFlight: Promise<void> | null = null;
  private timer = setInterval(() => this.flush(), EDIT_INTERVAL_MS);

  constructor(private api: Api, private chatId: number) {}

  addText(chunk: string) {
    this.text += chunk;
    this.status = "";
    if (this.messageId === undefined) this.flush();
  }

  setStatus(status: string) {
    this.status = status;
    if (this.messageId === undefined) this.flush();
  }

  async finish(finalText = this.text) {
    clearInterval(this.timer);
    await this.inFlight;

    if (!finalText.trim()) {
      // Only a tool status was showing, and it isn't needed any more.
      if (this.messageId !== undefined) await this.api.deleteMessage(this.chatId, this.messageId).catch(() => {});
      return;
    }

    const chunks = splitText(finalText.trim());
    for (const [i, chunk] of chunks.entries()) {
      const editId = i === 0 ? this.messageId : undefined;
      try {
        await this.post(toTelegramHtml(chunk), editId, true);
      } catch {
        // Fallback without formatting if special characters conflict
        await this.post(chunk, editId, false).catch((err) => {
          if (!String(err?.description).includes("not modified")) console.error("[Telegram Error]:", err?.message);
        });
      }
    }
  }

  private flush() {
    if (this.inFlight) return;
    const preview = this.preview();
    if (!preview || preview === this.shown) return;
    this.shown = preview;
    this.inFlight = this.post(preview, this.messageId, false)
      .catch(() => {})
      .finally(() => {
        this.inFlight = null;
      });
  }

  /** The reply so far as plain text, with the current tool status underneath. */
  private preview(): string {
    let body = this.text.replace(/\*\*/g, "").trim();
    if (body.length > MESSAGE_LIMIT) body = `${body.slice(0, MESSAGE_LIMIT)}…`;
    return [body, this.status].filter(Boolean).join("\n\n");
  }

  private async post(text: string, editId: number | undefined, html: boolean) {
    const options = html ? { parse_mode: "HTML" as const } : {};
    if (editId !== undefined) {
      await this.api.editMessageText(this.chatId, editId, text, options);
    } else {
      const message = await this.api.sendMessage(this.chatId, text, options);
      this.messageId ??= message.message_id;
    }
  }
}

/** Splits text into pieces Telegram accepts, preferring paragraph and line breaks. */
function splitText(text: string): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > MESSAGE_LIMIT) {
    let cut = rest.lastIndexOf("\n\n", MESSAGE_LIMIT);
    if (cut < MESSAGE_LIMIT / 2) cut = rest.lastIndexOf("\n", MESSAGE_LIMIT);
    if (cut < MESSAGE_LIMIT / 2) cut = rest.lastIndexOf(" ", MESSAGE_LIMIT);
    if (cut <= 0) cut = MESSAGE_LIMIT;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Converts the simple Markdown the model writes into the HTML subset Telegram supports. */
function toTelegramHtml(markdown: string): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Code is set aside first so nothing inside it gets formatted.
  const code: string[] = [];
  const keep = (html: string) => `\u0000${code.push(html) - 1}\u0000`;
  const text = markdown
    .replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, body: string) => keep(`<pre>${escape(body.trimEnd())}</pre>`))
    .replace(/`([^`\n]+)`/g, (_, body: string) => keep(`<code>${escape(body)}</code>`));

  return escape(text)
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label: string, url: string) => `<a href="${url.replace(/"/g, "&quot;")}">${label}</a>`)
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/^(\s*)[*-]\s+/gm, "$1• ")
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1<i>$2</i>")
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => code[Number(i)]);
}
