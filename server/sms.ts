export interface SmsSender {
  send(to: string, text: string): Promise<void>;
}

/** Development: prints each SMS to the log and keeps it, so the sign-in screen can show the code. */
export class ConsoleSms implements SmsSender {
  sent: { to: string; text: string }[] = [];
  async send(to: string, text: string) {
    this.sent.push({ to, text });
    console.log(`[sms to ${to}] ${text}`);
  }
}
