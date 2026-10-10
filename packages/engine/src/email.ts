export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
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
