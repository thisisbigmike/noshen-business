import { useState } from "react";
import { Button } from "@noshen/ui/ui";

/** Copies text, says "Copied" for a moment, and tells the page (to show "Waiting for your transfer"). */
export function CopyButton({ text, label = "Copy", onCopied }: { text: string; label?: string; onCopied?: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <Button onClick={async () => { await navigator.clipboard?.writeText(text).catch(() => {}); setDone(true); onCopied?.(); setTimeout(() => setDone(false), 2500); }}
      aria-live="polite">{done ? "Copied" : label}</Button>
  );
}
