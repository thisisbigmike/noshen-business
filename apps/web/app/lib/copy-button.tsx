import { useState } from "react";
import { Button } from "@noshen/ui/ui";
import { useT } from "@noshen/ui/i18n";

/** Copies text, says "Copied" for a moment, and tells the page (to show "Waiting for your transfer"). */
export function CopyButton({ text, label, onCopied }: { text: string; label?: string; onCopied?: () => void }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <Button onClick={async () => { await navigator.clipboard?.writeText(text).catch(() => {}); setDone(true); onCopied?.(); setTimeout(() => setDone(false), 2500); }}
      aria-live="polite">{done ? t("Copied") : label ?? t("Copy")}</Button>
  );
}
