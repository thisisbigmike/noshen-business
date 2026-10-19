// "Stuck? Chat with us on WhatsApp" at the bottom of each selling step: a person to ask, with the step already said
// in the message. Shown only once NosHen's number is set (the support_whatsapp setting).
import { Icon } from "@noshen/ui/ui";
import { useT } from "@noshen/ui/i18n";

export function SellHelp({ whatsapp, step }: { whatsapp: string | null; step: string }) {
  const t = useT();
  const number = whatsapp?.replace(/\D/g, "");
  if (!number) return null;
  const text = t("Hello NosHen, I need help listing something. I'm on the {step} step.", { step });
  return (
    <p className="sell-help caption">
      <Icon name="brand-whatsapp" size={18} />
      <span>{t.rich("Stuck? <chat>Chat with us on WhatsApp</chat>. A person will help you.", {
        chat: (s) => <a href={`https://wa.me/${number}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">{s}</a>,
      })}</span>
    </p>
  );
}
