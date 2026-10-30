import { Link, data } from "react-router";
import type { Route } from "./+types/person";
import { env } from "cloudflare:workers";
import { messageOf, requireStaff, withApp } from "../../server/web";
import { staffPerson } from "@noshen/engine/queries";
import { removeProfilePhoto, setAccountStatus, setAgentBlocked, setDealLimit, staffUnlinkAgent } from "@noshen/engine/staff";
import { staffAgentView } from "@noshen/engine/agent";
import { walletActivity, walletBalances } from "@noshen/engine/wallets";
import { coinAmount, networkOf } from "@noshen/shared/payments";
import { deletePhoto } from "@noshen/engine/photos";
import { settingsOf } from "@noshen/engine/core";
import { Avatar, Icon, Info, Kv, TextField } from "@noshen/ui/ui";
import { naira } from "@noshen/shared/money";
import { ago, when } from "@noshen/shared/time";
import { photoUrl } from "@noshen/shared/photos";
import { ACCOUNT_STATUS, DEAL_STATE, StatePill, actionLabel } from "../lib/labels";
import { ReasonAction, type ActionResult } from "../lib/reason-action";

export const meta: Route.MetaFunction = ({ loaderData: v }) => [{ title: `${v?.user.full_name ?? "Person"} · NosHen staff` }];

export async function loader({ request, params }: Route.LoaderArgs) {
  const staff = await requireStaff(request);
  return withApp(async (d) => {
    const v = await staffPerson(d.db, params.id);
    if (!v) throw data("Not found", { status: 404 });
    const [s, assistant, balances, activity] = await Promise.all([
      settingsOf(d), staffAgentView(d.db, params.id), walletBalances(d, params.id), walletActivity(d, params.id, 10),
    ]);
    return { ...v, assistant, wallet: { balances, activity }, isAdmin: staff.role === "admin", appUrl: env.APP_URL, standardCap: s.unverified_seller_max_kobo };
  });
}

export async function action({ request, params }: Route.ActionArgs): Promise<ActionResult> {
  const staff = await requireStaff(request);
  const f = await request.formData();
  const intent = String(f.get("intent"));
  const reason = String(f.get("reason") ?? "");
  try {
    if (intent === "freeze" || intent === "ban" || intent === "activate") {
      const status = intent === "freeze" ? "frozen" : intent === "ban" ? "banned" : "active";
      await withApp((d) => setAccountStatus(d, staff, params.id, status, reason));
      return { ok: true, intent, message: status === "active" ? "The account is active again, and they've been told." : `The account is ${status}. They've been told it's paused.` };
    }
    if (intent === "limit") {
      const raw = String(f.get("limit") ?? "").replace(/[₦,\s]/g, "");
      const amount = Number(raw);
      if (!raw || !Number.isFinite(amount) || amount <= 0) return { ok: false, intent, error: "Type the limit in naira, for example 500000." };
      await withApp((d) => setDealLimit(d, staff, params.id, Math.round(amount * 100), reason));
      return { ok: true, intent, message: "Limit saved. They've been told." };
    }
    if (intent === "remove_photo") {
      const old = await withApp((d) => removeProfilePhoto(d, staff, params.id, reason));
      if (old) await deletePhoto(old).catch((e) => console.error("couldn't delete profile photo", e));
      return { ok: true, intent, message: "Photo removed. They've been told why." };
    }
    if (intent === "assistant_block" || intent === "assistant_unblock") {
      await withApp((d) => setAgentBlocked(d, staff, params.id, intent === "assistant_block", reason));
      return { ok: true, intent, message: intent === "assistant_block" ? "The assistant can't act for them now. They've been told." : "The assistant can act for them again. They've been told." };
    }
    if (intent === "assistant_unlink") {
      await withApp((d) => staffUnlinkAgent(d, staff, String(f.get("link")), reason));
      return { ok: true, intent, message: "Chat unlinked. They've been told." };
    }
    if (intent === "standard") {
      await withApp((d) => setDealLimit(d, staff, params.id, null, reason));
      return { ok: true, intent, message: "Back on the standard rules." };
    }
    return { ok: false, intent, error: "Unknown action." };
  } catch (e) {
    return { ok: false, intent, error: messageOf(e) };
  }
}

const LISTING_STATUS: Record<string, { label: string; tone: string }> = {
  live: { label: "Live", tone: "ok" }, paused: { label: "Paused", tone: "muted" }, sold: { label: "Sold", tone: "brand" },
  removed: { label: "Removed", tone: "bad" }, blocked: { label: "Held for checks", tone: "warn" },
};

export default function Person({ loaderData: v }: Route.ComponentProps) {
  const u = v.user;
  const verified = v.kyc?.result === "verified" && !!v.bank;
  const bought = v.deals.filter((x: any) => x.side === "buying").length;
  const sold = v.deals.filter((x: any) => x.side === "selling").length;
  const liveListings = v.listings.filter((l: any) => l.status === "live").length;
  return (
    <>
      <nav className="caption muted" aria-label="Breadcrumb"><Link to="/">Dashboard</Link> / <Link to="/users">People</Link> / {u.full_name ?? u.email}</nav>
      <header className="console-head">
        <div className="cell-listing">
          <Avatar name={u.full_name ?? u.email ?? "?"} photo={u.photo_key} />
          <div className="stack" style={{ gap: 4 }}>
            <h1 className="heading">{u.full_name ?? "No name yet"}</h1>
            <div className="row wrap" style={{ gap: 8 }}>
              <StatePill map={ACCOUNT_STATUS} value={u.status} />
              <span className="caption muted">{u.email ?? "No email"}{u.phone ? ` · ${u.phone}` : ""} · joined {ago(u.created_at)}</span>
            </div>
          </div>
        </div>
      </header>

      {u.status !== "active" ? (
        <Info icon="lock" tone={u.status === "banned" ? "danger" : "warn"}>
          This account is {u.status}. They can't buy or sell, and their listings are hidden from Browse. Deals already under way carry on.
        </Info>
      ) : null}

      <div className="kpis">
        <div className="kpi"><p className="caption muted">Bought</p><p className="kpi-value tabular">{bought}</p><p className="caption muted">deals as buyer</p></div>
        <div className="kpi"><p className="caption muted">Sold</p><p className="kpi-value tabular">{sold}</p><p className="caption muted">deals as seller</p></div>
        <div className="kpi"><p className="caption muted">Live listings</p><p className="kpi-value tabular">{liveListings}</p><p className="caption muted">{v.listings.length} in all</p></div>
        <div className="kpi"><p className="caption muted">Disputes</p><p className="kpi-value tabular">{v.disputeCount}</p><p className="caption muted">in their deals</p></div>
        <div className="kpi"><p className="caption muted">Deal limit</p><p className="kpi-value tabular">{u.max_deal_kobo ? naira(u.max_deal_kobo) : verified ? "None" : naira(v.standardCap)}</p><p className="caption muted">{u.max_deal_kobo ? "Set by staff" : verified ? "Verified: no limit" : "Until verified"}</p></div>
      </div>

      <div className="detail-grid">
        <div className="stack-4">
          <section className="panel" aria-labelledby="deals-title">
            <div className="panel-head"><h2 id="deals-title" className="title">Deals</h2><span className="caption muted">{v.deals.length}</span></div>
            {v.deals.length === 0 ? <p className="caption muted">No deals yet.</p> : (
              <div className="table-scroll" tabIndex={0} role="region" aria-label="Their deals (scrolls sideways)">
                <table className="table">
                  <thead><tr><th>Deal</th><th>Amount</th><th>State</th><th className="cell-action"><span className="sr-only">Open</span></th></tr></thead>
                  <tbody>{v.deals.map((x: any) => (
                    <tr key={x.id}>
                      <td><Link to={`/deals/${x.id}`} className="body ink-link">{x.title}</Link><p className="caption muted">{x.side === "buying" ? `Buying from ${x.other ?? "seller"}` : `Selling to ${x.other ?? "buyer"}`} · {ago(x.created_at)}</p></td>
                      <td className="tabular">{naira(x.amount_due_kobo)}</td>
                      <td><div className="row wrap" style={{ gap: 6 }}><StatePill map={DEAL_STATE} value={x.state} />{x.review_hold ? <span className="st-pill warn">Review hold</span> : null}</div></td>
                      <td className="cell-action"><Link to={`/deals/${x.id}`} className="nh-btn nh-btn-secondary nh-btn-sm" prefetch="intent">Open</Link></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="listings-title">
            <div className="panel-head"><h2 id="listings-title" className="title">Listings</h2><Link to={`/listings?q=${encodeURIComponent(u.full_name ?? "")}`} className="caption">Moderate</Link></div>
            {v.listings.length === 0 ? <p className="caption muted">No listings.</p> : (
              <ul className="mini-list">
                {v.listings.map((l: any) => (
                  <li key={l.id}>
                    <span className="thumb">{l.photo_keys?.[0] ? <img src={photoUrl(l.photo_keys[0])} alt="" loading="lazy" /> : <Icon name="photo" size={20} />}</span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <a href={`${v.appUrl}/l/${l.id}`} target="_blank" rel="noreferrer" className="body ink-link truncate">{l.title}</a>
                      <p className="caption muted">{naira(l.price_kobo)} · {ago(l.published_at ?? l.created_at)}</p>
                    </div>
                    <StatePill map={LISTING_STATUS} value={l.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="stack-4">
          <section className="panel" aria-labelledby="checks-title">
            <h2 id="checks-title" className="title">Checks</h2>
            <div>
              <Kv k="ID" v={v.kyc ? <span className={v.kyc.result === "verified" ? "ok-text" : ""}>{v.kyc.type.toUpperCase()} {v.kyc.result}{v.kyc.verified_name ? ` · ${v.kyc.verified_name}` : ""}</span> : <span className="muted">Not done</span>} />
              <Kv k="Bank" v={v.bank ? <span className="ok-text">••{v.bank.account_last4} · {v.bank.account_name}</span> : <span className="muted">Not added</span>} />
              {v.bank ? <Kv k="Name matches ID" v={v.bank.name_matches_id ? "Yes" : <span className="error-text">No</span>} /> : null}
            </div>
          </section>

          <section className="panel" aria-labelledby="account-title">
            <h2 id="account-title" className="title">Account</h2>
            {u.status === "active" ? (
              <>
                <ReasonAction intent="freeze" label="Freeze account" danger
                  help="They can't buy or sell, and their listings leave Browse, until you unfreeze it. Their open deals carry on and the money stays held. They're told the account is paused, not your reason." />
                {v.isAdmin ? <ReasonAction intent="ban" label="Ban account" danger help="For fraud or serious misuse. Like freezing, but only an admin can lift it." /> : null}
              </>
            ) : u.status === "frozen" || v.isAdmin ? (
              <ReasonAction intent="activate" label={u.status === "banned" ? "Lift the ban" : "Unfreeze account"} help="They can buy and sell again, and their live listings come back to Browse. They're told." />
            ) : (
              <p className="caption muted">Only an admin can lift a ban.</p>
            )}
          </section>

          {u.photo_key ? (
            <section className="panel" aria-labelledby="photo-title">
              <h2 id="photo-title" className="title">Profile picture</h2>
              <a href={photoUrl(u.photo_key)} target="_blank" rel="noreferrer" className="photo-slot" style={{ width: 120 }}><img src={photoUrl(u.photo_key)} alt={`${u.full_name ?? "Their"} profile picture`} /></a>
              <ReasonAction intent="remove_photo" label="Remove photo" danger
                help="For someone else's photo, a bank's or NosHen's logo, or anything offensive. They're told your reason and can add another." />
            </section>
          ) : null}

          <section className="panel" aria-labelledby="limit-title">
            <h2 id="limit-title" className="title">Deal limit</h2>
            <p className="caption muted">The most they can take as a seller in one deal. Standard rules: {naira(v.standardCap)} until their ID and bank are checked, then no limit.</p>
            <ReasonAction intent="limit" label={u.max_deal_kobo ? `Change limit (now ${naira(u.max_deal_kobo)})` : "Set a limit"}
              help="Applies whatever their checks. Buyers see it on their listings before they start a deal.">
              <TextField label="Limit in naira" name="limit" inputMode="numeric" required placeholder="500000" defaultValue={u.max_deal_kobo ? String(Number(u.max_deal_kobo) / 100) : ""} />
            </ReasonAction>
            {u.max_deal_kobo ? <ReasonAction intent="standard" label="Use the standard rules" help="Removes the limit you set." /> : null}
          </section>

          <section className="panel" aria-labelledby="wallet-title">
            <h2 id="wallet-title" className="title">Wallet</h2>
            {v.wallet.balances.length === 0 ? <p className="caption muted">Nothing held.</p> : (
              <div>{v.wallet.balances.map((b) => <Kv key={b.coin + b.network} k={networkOf(b.network).name} v={coinAmount(b.micro, b.coin)} />)}</div>
            )}
            {v.wallet.activity.length ? (
              <ul className="mini-list">
                {v.wallet.activity.map((a) => (
                  <li key={a.kind + a.id} className="stack" style={{ gap: 2 }}>
                    <span className="body">{a.kind === "deposit" ? "Deposit" : `Withdrawal to ••${a.to_last4}`} · {coinAmount(a.micro, a.coin)} on {networkOf(a.network).name}</span>
                    <span className="caption muted">{a.status} · {when(new Date(a.at))}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="panel" aria-labelledby="assistant-title">
            <h2 id="assistant-title" className="title">NosHen assistant</h2>
            {v.assistant.blockedAt ? <Info icon="lock" tone="warn">Stopped by staff {ago(v.assistant.blockedAt)}. It can't act for them, even from a linked chat.</Info> : null}
            {v.assistant.links.length === 0 ? <p className="caption muted">No Telegram chat linked.</p> : v.assistant.links.map((l) => (
              <div key={l.id} className="stack" style={{ gap: 6 }}>
                <span className="body">Telegram{l.external_name ? `: ${l.external_name}` : ""} · linked {ago(l.created_at)}</span>
                <ReasonAction intent="assistant_unlink" hidden={{ link: l.id }} label="Unlink this chat" danger
                  help="The chat can't act for them until they link it again with /link. They're told it was unlinked, not your reason." />
              </div>
            ))}
            {v.assistant.blockedAt
              ? <ReasonAction intent="assistant_unblock" label="Let the assistant act again" help="Their linked chats work again. They're told." />
              : <ReasonAction intent="assistant_block" label="Stop the assistant for them" danger
                  help="Their chats stay linked, but the assistant can't look anything up or act for them until you allow it again. They're told it was stopped, not your reason." />}
            {v.assistant.requests.length ? (
              <div className="stack" style={{ gap: 2 }}>
                <p className="label">Latest requests</p>
                {v.assistant.requests.map((r, i) => <span key={i} className="caption">{r.action}{r.ok ? "" : " (refused)"} · {when(new Date(r.at))}</span>)}
              </div>
            ) : null}
          </section>

          <section className="panel" aria-labelledby="history-title">
            <div className="panel-head"><h2 id="history-title" className="title">Staff actions</h2><Link to={`/audit?target=${u.id}`} className="caption">In the audit log</Link></div>
            {v.actions.length === 0 ? <p className="caption muted">None yet.</p> : v.actions.map((a: any, i: number) => (
              <div key={i} className="stack" style={{ gap: 2 }}>
                <span className="label">{actionLabel(a.action)}</span>
                <span className="caption muted">{a.name} · {when(new Date(a.at))}</span>
                <span className="caption">{a.reason}</span>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </>
  );
}
