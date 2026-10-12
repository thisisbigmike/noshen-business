import { useEffect, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { Button, ErrorText, TextArea } from "@noshen/ui/ui";

export type ActionResult = { ok: true; intent: string; message: string } | { ok: false; intent: string; error: string };

/**
 * A staff action that needs a reason: a button that opens a small form in place. It posts to the page's action
 * (intent, any hidden fields, reason), shows a refusal where it happened, and closes once done. The page's data
 * reloads by itself after the post, so what changed shows straight away.
 */
export function ReasonAction({ intent, label, help, danger, hidden, children, confirmLabel, reasonLabel, reasonHint }: {
  intent: string; label: string; help: string; danger?: boolean; hidden?: Record<string, string>; children?: ReactNode; confirmLabel?: string;
  /** For when the text is more than a reason, for example a note both people will read. */
  reasonLabel?: string; reasonHint?: string;
}) {
  const fetcher = useFetcher<ActionResult>();
  const [open, setOpen] = useState(false);
  const busy = fetcher.state !== "idle";
  const mine = fetcher.data?.intent === intent ? fetcher.data : null;
  useEffect(() => { if (fetcher.state === "idle" && mine?.ok) setOpen(false); }, [fetcher.state, mine]);
  if (!open) {
    return (
      <div className="stack" style={{ gap: 6 }}>
        <Button variant={danger ? "danger" : "secondary"} onClick={() => setOpen(true)}>{label}</Button>
        {mine?.ok ? <p className="caption ok-text" role="status">{mine.message}</p> : null}
      </div>
    );
  }
  return (
    <fetcher.Form method="post" className="action-form stack">
      <input type="hidden" name="intent" value={intent} />
      {hidden ? Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />) : null}
      <p className="label">{label}</p>
      <p className="caption muted">{help}</p>
      {children}
      <TextArea label={reasonLabel ?? "Reason"} name="reason" required minLength={5} hint={reasonHint ?? "Kept in the audit log with your name."} autoFocus />
      <ErrorText>{mine && !mine.ok ? mine.error : null}</ErrorText>
      <div className="row wrap">
        <Button type="submit" variant={danger ? "danger" : "primary"} disabled={busy}>{busy ? "Saving…" : confirmLabel ?? "Confirm"}</Button>
        <Button onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
      </div>
    </fetcher.Form>
  );
}
