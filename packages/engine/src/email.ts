export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  /** False when no email is sent at all: sign-in by email code is off and updates are in-app only. */
  readonly enabled?: boolean;
  send(message: EmailMessage): Promise<void>;
}

/** Development: prints each email to the log and keeps it, so the sign-in screen can show the code. */
export class ConsoleEmail implements EmailSender {
  sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
    console.log(`[email to ${message.to}] ${message.subject}\n${message.text}`);
  }
}

/** No email provider yet (a public demo without a domain): nothing is sent, and sign-in is by Google only. */
export class NoEmail implements EmailSender {
  readonly enabled = false;
  async send(): Promise<void> {
    throw new Error("Email isn't set up on this site.");
  }
}
