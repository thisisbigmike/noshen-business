import { useEffect, useRef, useState } from "react";
import { Button, Icon } from "@noshen/ui/ui";
import { useT } from "@noshen/ui/i18n";

/**
 * Shares a listing. Where the device has its own share sheet (phones, and some computers), that opens, with
 * whatever the person has installed: WhatsApp, Instagram, Messages and so on. Elsewhere a small menu opens with
 * WhatsApp, Facebook, X and Copy link. `text` is the message without the link; the link is added to it.
 */
export function ShareButton({ path, title, text, kind = "button" }: { path: string; title: string; text: string; kind?: "button" | "icon" }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const url = () => new URL(path, location.origin).toString();

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", esc); };
  }, [open]);

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url: url() });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return; // they closed the share sheet
      }
    }
    setCopied(false);
    setOpen((o) => !o);
  }

  async function copy() {
    await navigator.clipboard?.writeText(url()).catch(() => {});
    setCopied(true);
    setTimeout(() => setOpen(false), 1200);
  }

  const message = () => `${text} ${t("Buy it here: {url}", { url: url() })}`;
  return (
    <div className={kind === "icon" ? "share" : "share block"} ref={box}>
      {kind === "icon" ? (
        <button type="button" className="icon-btn" aria-label={t("Share this listing")} aria-haspopup="menu" aria-expanded={open} onClick={share}><Icon name="share" /></button>
      ) : (
        <Button size="lg" block icon="share" aria-haspopup="menu" aria-expanded={open} onClick={share}>{t("Share")}</Button>
      )}
      {open ? (
        <div className="share-menu" role="menu" aria-label={t("Share this listing")}>
          <a role="menuitem" href={`https://wa.me/?text=${encodeURIComponent(message())}`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            <Icon name="brand-whatsapp" />WhatsApp
          </a>
          <a role="menuitem" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url())}`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            <Icon name="brand-facebook" />Facebook
          </a>
          <a role="menuitem" href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url())}`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            <Icon name="brand-x" />X
          </a>
          <button type="button" role="menuitem" onClick={copy} aria-live="polite">
            <Icon name={copied ? "check" : "link"} />{copied ? t("Link copied") : t("Copy link")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
