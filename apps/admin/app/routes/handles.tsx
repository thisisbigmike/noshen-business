import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useFetcher } from "react-router";
import type { Route } from "./+types/handles";
import { messageOf, requireStaff, withApp } from "../../server/web";
import { decideHandle, handlesToCheck } from "@noshen/engine/handles";
import { Button, CheckedForm, ErrorText, Icon, Info, TextArea, useEscape } from "@noshen/ui/ui";
import { platformOf, profileUrl, type Platform } from "@noshen/shared/social";
import { ago } from "@noshen/shared/time";

export const meta = () => [{ title: "Handles · NosHen staff" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireStaff(request);
  return { rows: await withApp((d) => handlesToCheck(d.db)) };
}

export async function action({ request }: Route.ActionArgs) {
  const staff = await requireStaff(request);
  const f = await request.formData();
  const id = String(f.get("handle") ?? "");
  const verified = f.get("act") === "verify";
  try {
    await withApp((d) => decideHandle(d, staff, id, verified, String(f.get("reason") ?? "")));
  } catch (e) {
    return { ok: false as const, id, error: messageOf(e) };
  }
  return { ok: true as const, id, verified };
}

type Row = { id: string; platform: Platform; handle: string; code: string; submitted_at: string; user_id: string; full_name: string | null; email: string };

/**
 * Social handles sellers say carry their code: open the profile, look for the code in the bio, then verify it (buyers
 * can find the seller by it) or say it isn't there (the seller is told why and can try again).
 */
export default function Handles({ loaderData: { rows } }: Route.ComponentProps) {
  const fetcher = useFetcher<typeof action>({ key: "handle" });
  const [target, setTarget] = useState<{ row: Row; act: "verify" | "reject" } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const busy = fetcher.state !== "idle";
  useEscape(!!target, () => setTarget(null), busy);
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.ok || !target || fetcher.data.id !== target.row.id) return;
    const who = target.row.full_name?.split(" ")[0] ?? "The seller";
    setDone(fetcher.data.verified ? `Verified @${target.row.handle}. Buyers who check it now see ${who}'s track record.` : `Not verified: @${target.row.handle}. ${who} has been told why.`);
    setTarget(null);
  }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = rows as Row[];
  const error = fetcher.data && !fetcher.data.ok && target && fetcher.data.id === target.row.id ? fetcher.data.error : null;
  return (
    <>
      <header className="console-head">
        <div className="stack">
          <h1 className="heading">Handles to check</h1>
          <p className="body muted">Sellers' Instagram, TikTok, Facebook and X names. Open the profile and look for the seller's code in the bio. Verify only if you see that exact code: buyers trust what "Check a seller" shows them.</p>
        </div>
      </header>
      {done ? <Info icon="circle-check">{done} <Link to="/audit">See audit log</Link></Info> : null}
      <section className="panel" aria-label="Handles to check">
        {list.length === 0 ? (
          <div className="empty-mini"><Icon name="circle-check" size={28} /><p className="label">Nothing to check</p><p className="caption muted">New handles show here when a seller says the code is in their bio.</p></div>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Handles (scrolls sideways)">
            <table className="table">
              <thead><tr><th>Profile</th><th>Code to look for</th><th>Seller</th><th>Sent</th><th className="cell-action"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{list.map((h) => (
                <tr key={h.id}>
                  <td><a href={profileUrl(h.platform, h.handle)} target="_blank" rel="noreferrer" className="body ink-link">{platformOf(h.platform).label} @{h.handle} <Icon name="external-link" size={14} /></a></td>
                  <td><code className="mono-sm" style={{ fontSize: 15, fontWeight: 700 }}>{h.code}</code></td>
                  <td><Link to={`/users/${h.user_id}`} className="body ink-link">{h.full_name ?? "No name"}</Link><p className="caption muted">{h.email}</p></td>
                  <td className="caption" style={{ whiteSpace: "nowrap" }}>{ago(h.submitted_at)}</td>
                  <td className="cell-action">
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      <Button size="sm" variant="primary" onClick={() => { setDone(null); setTarget({ row: h, act: "verify" }); }}>Verify</Button>
                      <Button size="sm" onClick={() => { setDone(null); setTarget({ row: h, act: "reject" }); }}>Not there</Button>
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {target ? createPortal(
        <div className="sheet-backdrop" onClick={() => !busy && setTarget(null)}>
          <CheckedForm method="post" navigate={false} fetcherKey="handle" className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="h-title">
            <input type="hidden" name="handle" value={target.row.id} />
            <input type="hidden" name="act" value={target.act} />
            <h2 id="h-title" className="heading">{target.act === "verify" ? `Verify @${target.row.handle}?` : `@${target.row.handle}: code not there?`}</h2>
            <p className="body">{target.act === "verify"
              ? <>Only if <strong>{target.row.code}</strong> is in the bio of <a href={profileUrl(target.row.platform, target.row.handle)} target="_blank" rel="noreferrer">{platformOf(target.row.platform).label} @{target.row.handle}</a>. Buyers who check this handle will see {target.row.full_name ?? "this seller"}'s track record.</>
              : <>The seller is told your reason and can add the code and send it again.</>}</p>
            <TextArea name="reason" label={target.act === "verify" ? "What you saw" : "Reason (the seller sees this)"} rows={2} required minLength={5} maxLength={300} autoFocus
              missing={target.act === "verify" ? "Write what you saw, for the audit log." : "Write why, so the seller can fix it."}
              placeholder={target.act === "verify" ? "Code in the bio on 19 Oct" : "The code isn't in the bio."} />
            <ErrorText>{error}</ErrorText>
            <Button type="submit" variant={target.act === "verify" ? "primary" : "danger"} size="lg" block disabled={busy}>{busy ? "Saving…" : target.act === "verify" ? "Verify handle" : "Not verified"}</Button>
            <Button size="lg" block disabled={busy} onClick={() => setTarget(null)}>Back</Button>
          </CheckedForm>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
