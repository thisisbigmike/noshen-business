export interface SmsMessage {
  to: string;
  body: string;
  channel?: "dnd" | "whatsapp" | "generic";
}

export interface SmsSender {
  readonly enabled?: boolean;
  send(message: SmsMessage): Promise<void>;
}

/**
 * Nigerian SMS & WhatsApp alerts via Termii (https://termii.com).
 * Activated when TERMII_API_KEY is set as a Worker secret. Sends high-signal deal updates
 * (request received, money held, payout sent, dispute opened) to Nigerian phone numbers.
 */
export class TermiiSms implements SmsSender {
  readonly enabled = true;
  constructor(
    private apiKey: string,
    private senderId: string = "NosHen",
    private defaultChannel: "dnd" | "whatsapp" | "generic" = "dnd",
  ) {}

  async send(message: SmsMessage): Promise<void> {
    const normalized = normalizeNgPhone(message.to);
    if (!normalized) return;
    const res = await fetch("https://api.ng.termii.com/api/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        to: normalized,
        from: this.senderId,
        sms: message.body.slice(0, 320),
        type: "plain",
        channel: message.channel ?? this.defaultChannel,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => String(res.status));
      throw new Error(`Termii SMS failed (${res.status}): ${detail.slice(0, 200)}`);
    }
  }
}

/** Normalises Nigerian numbers (080..., +23480..., 23480...) into international digits without '+'. */
export function normalizeNgPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/[^\d]/g, "");
  if (digits.length === 11 && digits.startsWith("0")) return `234${digits.slice(1)}`;
  if (digits.length === 13 && digits.startsWith("234")) return digits;
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}
