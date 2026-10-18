import { Link, NavLink, Outlet, useMatches } from "react-router";
import type { Route } from "./+types/_app";
import { optionalUser, withApp } from "../../server/web";
import { dealsFor, needsAction, unreadCount } from "@noshen/engine/queries";
import { Button, Icon, Wordmark } from "@noshen/ui/ui";
import type { IconName } from "@noshen/ui/icons";
import { ThemeToggle } from "@noshen/ui/theme";
import { useT } from "@noshen/ui/i18n";
import { msg } from "@noshen/shared/i18n";
import { LanguageToggle } from "../lib/prefs";

export async function loader({ request }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await optionalUser(request, d);
    if (!user) return { user: null, dealsNeedingYou: 0, unread: 0 };
    const deals = await dealsFor(d.db, user.id);
    return {
      user: { id: user.id, name: user.full_name },
      dealsNeedingYou: deals.filter(needsAction).length,
      unread: await unreadCount(d.db, user.id),
    };
  });
}

const TABS: [string, string, IconName][] = [["/browse", msg("Browse"), "search"], ["/deals", msg("Deals"), "receipt"], ["/sell", msg("Sell"), "plus"], ["/notifications", msg("Alerts"), "bell"], ["/account", msg("Account"), "user"]];
const DESKTOP = TABS.filter(([to]) => to !== "/notifications");

export default function AppShell({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const matches = useMatches();
  const hideTabs = matches.some((m) => (m.handle as { tabs?: boolean } | undefined)?.tabs === false);
  const badge = loaderData.dealsNeedingYou;
  const unread = loaderData.unread;
  const countFor = (to: string) => (to === "/deals" ? badge : to === "/notifications" ? unread : 0);
  return (
    <div className={hideTabs ? "shell" : "shell with-tabs"}>
      <header className="desktop-nav">
        <Link to="/" prefetch="intent" aria-label={t("NosHen home")} style={{ textDecoration: "none", justifySelf: "start" }}><Wordmark /></Link>
        <nav aria-label="Main">
          {DESKTOP.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === "/browse"} className="navlink" prefetch="intent">
              <Icon name={icon} size={18} />{t(label)}{to === "/deals" && badge ? <span className="count" aria-label={t(", {n} need you", { n: badge })}>{badge}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="end">
          <LanguageToggle />
          <ThemeToggle />
          {loaderData.user ? (
            <Link to="/notifications" className="icon-btn" aria-label={unread ? t("Notifications, {n} new", { n: unread }) : t("Notifications")}>
              <Icon name="bell" />{unread ? <span className="dot-count" aria-hidden="true">{unread}</span> : null}
            </Link>
          ) : (
            <Button variant="primary" pill to="/signin">{t("Sign in")}</Button>
          )}
        </div>
      </header>
      <Outlet />
      {hideTabs ? null : (
        <nav className="tabs" aria-label="Main">
          {TABS.map(([to, label, icon]) => {
            const n = countFor(to);
            return (
              // Each page starts loading as the finger lands on its tab. Not Alerts: opening it marks alerts as read.
              <NavLink key={to} to={to} end={to === "/browse"} className={to === "/sell" ? "tab tab-main" : "tab"} title={t(label)} prefetch={to === "/notifications" ? "none" : "intent"}>
                <Icon name={icon} size={to === "/sell" ? 24 : 22} />
                <span className="tab-label">{t(label)}</span>
                {n ? <span className="badge" aria-label={to === "/deals" ? (n === 1 ? t("1 deal needs you") : t("{n} deals need you", { n })) : t("{n} new", { n })}>{n}</span> : null}
              </NavLink>
            );
          })}
        </nav>
      )}
    </div>
  );
}
