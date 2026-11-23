import { Form, Link } from "react-router";
import type { Route } from "./+types/account";
import { requireUser, withApp, messageOf } from "../../server/web";
import { myListings, savedListingsFor, sellerSummary } from "@noshen/engine/queries";
import { sellerReady, setProfilePhoto } from "@noshen/engine/sellers";
import { one } from "@noshen/engine/db";
import { DealError } from "@noshen/engine/core";
import { Button, ErrorText, Icon, Info, Kv, TopBar } from "@noshen/ui/ui";
import { LEGAL_NAV } from "@noshen/shared/legal-pages";
import { ThemeSwitch } from "@noshen/ui/theme";
import { PushCard } from "../lib/push";
import { useLang, useT } from "@noshen/ui/i18n";
import { msg } from "@noshen/shared/i18n";
import { DataSaverSwitch, LanguageSwitch } from "../lib/prefs";
import { CountrySwitch } from "../lib/country";
import { HandlesCard, type Handle } from "../lib/handles";
import { ProfilePhoto } from "../lib/profile-photo";
import { deletePhoto, photosFrom, storePhoto } from "@noshen/engine/photos";
import { addHandle, myHandles, removeHandle, submitHandle } from "@noshen/engine/handles";
import { agentLinksOf, unlinkAgent } from "@noshen/engine/agent";

export const meta = () => [{ title: "Account · NosHen" }];

export async function loader({ request }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const [ready, summary, listings, saved, bank, kyc, handles, links] = await Promise.all([
      sellerReady(d, user.id), sellerSummary(d.db, user.id), myListings(d.db, user.id), savedListingsFor(d.db, user.id),
      one(d.db, "select account_name, account_last4 from bank_accounts where user_id = $1 and is_default and removed_at is null", [user.id]),
      one(d.db, "select type, verified_name from kyc_checks where user_id = $1 and result = 'verified' order by checked_at desc limit 1", [user.id]),
      myHandles(d.db, user.id), agentLinksOf(d.db, user.id),
    ]);
    return { user, ready, summary, listingCount: listings.length, savedCount: saved.length, bank, kyc, handles: handles as Handle[], links, walletLive: !!d.wallets };
  });
}

export async function action({ request }: Route.ActionArgs) {
  const f = await request.formData();
  const intent = String(f.get("intent") ?? "");
  try {
    await withApp(async (d) => {
      const user = await requireUser(request, d);
      // The profile picture: a new one replaces (and deletes) the old.
      if (intent === "photo_upload" || intent === "photo_remove") {
        const p = intent === "photo_upload" ? photosFrom(f, "photo")[0] : null;
        if (intent === "photo_upload" && !p) throw new DealError("photo", msg("Choose a photo."));
        const key = p ? await storePhoto(`avatars/${user.id}`, p.file, p.small) : null;
        const old = await setProfilePhoto(d, user.id, key);
        if (old) await deletePhoto(old).catch((e) => console.error("couldn't delete old profile photo", e));
        return;
      }
      // Social handles, for "Check a seller".
      if (intent === "handle_add") return void await addHandle(d, user.id, String(f.get("platform") ?? ""), String(f.get("handle") ?? ""));
      if (intent === "handle_submit") return submitHandle(d, user.id, String(f.get("handle")));
      if (intent === "handle_remove") return removeHandle(d, user.id, String(f.get("handle")));
      // A Telegram chat linked to the NosHen assistant.
      if (intent === "agent_unlink") return unlinkAgent(d, user.id, String(f.get("link")));
    });
    return { ok: true, intent };
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e), intent };
  }
}

export default function Account({ loaderData: x, actionData }: Route.ComponentProps) {
  const t = useT();
  const lang = useLang();
  return (
    <div>
      <TopBar title={t("Account")} />
      <main className="page account-page stack-4">
        <h1 className="heading desktop-only">{t("Account")}</h1>
        <div className="account-layout">
          <div className="account-profile">
            <section className="card stack-4">
              <ProfilePhoto name={x.user.full_name ?? x.user.email ?? "?"} photo={x.summary.photo}
                error={(actionData as any)?.intent?.startsWith("photo_") ? (actionData as any)?.error : null} />
              <div>
                <Kv k={t("Name")} v={x.user.full_name ?? t("Not added")} />
                <Kv k={t("Email")} v={x.user.email ?? t("Not added")} />
                <Kv k={t("Rating")} v={x.summary.rating ? t("{rating} from {n}", { rating: x.summary.rating, n: x.summary.ratingCount }) : t("No ratings yet")} />
                <Kv k={t("Completed sales")} v={String(x.summary.completedDeals)} />
              </div>
            </section>
            <section className="card link-list" aria-label={t("Your things")}>
              {x.listingCount ? (
                <Link to="/account/listings" className="row-between">
                  <span className="row"><Icon name="tag" size={18} />{t("My listings ({n})", { n: x.listingCount })}</span>
                  <Icon name="chevron-right" size={18} />
                </Link>
              ) : null}
              {x.listingCount ? (
                <Link to={`/s/${x.user.id}`} className="row-between">
                  <span className="row"><Icon name="external-link" size={18} />{t("Your shop")}</span>
                  <Icon name="chevron-right" size={18} />
                </Link>
              ) : null}
              <Link to="/saved" className="row-between">
                <span className="row"><Icon name="heart" size={18} />{x.savedCount ? t("Saved items ({n})", { n: x.savedCount }) : t("Saved items")}</span>
                <Icon name="chevron-right" size={18} />
              </Link>
              <Link to="/wallet" className="row-between">
                <span className="row"><Icon name="wallet" size={18} />{t("NosHen wallet")}{x.walletLive ? null : <span className="soon-tag">{t("Soon")}</span>}</span>
                <Icon name="chevron-right" size={18} />
              </Link>
            </section>
          </div>

          <div className="account-main">
            <section className="card stack">
              <p className="title">{t("Selling")}</p>
              <Kv k={t("ID check")} v={x.kyc ? t("Verified ({type})", { type: x.kyc.type.toUpperCase() }) : t("Not done")} />
              <Kv k={t("Payout bank")} v={x.bank ? `${x.bank.account_name} ••${x.bank.account_last4}` : t("Not added")} />
              {!x.ready.ready ? <Button variant="primary" to="/account/verify?next=/account" icon="shield-check">{t("Verify ID and bank")}</Button>
                : <Info icon="circle-check">{t("You can sell. Buyers see “ID verified” on your listings.")}</Info>}
            </section>
            <ErrorText>{/^(handle|photo|agent)_/.test((actionData as any)?.intent ?? "") ? null : (actionData as any)?.error}</ErrorText>
            {x.listingCount || x.handles.length ? (
              <HandlesCard handles={x.handles} idOk={x.ready.idOk} error={(actionData as any)?.intent?.startsWith("handle_") ? (actionData as any)?.error : null} />
            ) : null}
            <div className="account-grid">
              <PushCard />
              <section className="card stack" aria-labelledby="assistant">
                <p className="title" id="assistant">{t("NosHen assistant")}</p>
                <p className="caption muted">{t("The NosHen assistant on Telegram can show your wallet and where your deals stand. Send it /link to connect it to this account.")}</p>
                {x.links.map((l) => (
                  <div key={l.id} className="kv" style={{ alignItems: "center" }}>
                    <span className="body">{l.external_name ? t("Telegram: {name}", { name: l.external_name }) : t("Telegram chat")}</span>
                    <Form method="post" preventScrollReset>
                      <input type="hidden" name="intent" value="agent_unlink" />
                      <input type="hidden" name="link" value={l.id} />
                      <Button type="submit">{t("Unlink")}</Button>
                    </Form>
                  </div>
                ))}
                <ErrorText>{(actionData as any)?.intent === "agent_unlink" ? (actionData as any)?.error : null}</ErrorText>
              </section>
            </div>
            {/* Settings: one card, one line each, instead of a card per setting. */}
            <section className="card settings-card" aria-labelledby="settings">
              <p className="title" id="settings">{t("Settings")}</p>
              <div className="setting-row">
                <span className="stack" style={{ gap: 0 }}><span className="body">{t("Language")}</span><span className="caption muted">{t("Saved on this device.")}</span></span>
                <LanguageSwitch />
              </div>
              <div className="setting-row">
                <span className="stack" style={{ gap: 0 }}><span className="body">{t("Appearance")}</span><span className="caption muted">{t("Saved on this device.")}</span></span>
                <ThemeSwitch />
              </div>
              <div className="setting-row">
                <span className="stack" style={{ gap: 0 }}><span className="body">{t("Data saver")}</span><span className="caption muted">{t("Smaller photos and fewer updates, for small data plans.")}</span></span>
                <DataSaverSwitch />
              </div>
              <div className="setting-row">
                <span className="stack" style={{ gap: 0 }}><span className="body">{t("Country")}</span><span className="caption muted">{t("Nigeria is open. Others are coming.")}</span></span>
                <CountrySwitch className="up" />
              </div>
            </section>
          </div>

          <div className="account-foot">
            <section className="card link-list" aria-label={t("Help and legal")}>
              <p className="label muted">{t("Help and legal")}</p>
              {lang !== "en" ? <p className="caption muted">{t("These pages are in English.")}</p> : null}
              {LEGAL_NAV.map((p) => <Link key={p.slug} to={`/${p.slug}`} className="row-between">{t(p.title)}<Icon name="chevron-right" size={18} /></Link>)}
            </section>
            <Form method="post" action="/signout"><Button type="submit" icon="logout" block>{t("Sign out")}</Button></Form>
          </div>
        </div>
      </main>
    </div>
  );
}
