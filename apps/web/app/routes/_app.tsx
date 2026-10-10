import { Link, NavLink, Outlet, useMatches } from "react-router";
import type { Route } from "./+types/_app";
import { optionalUser, withApp } from "../../server/web";
import { dealsFor, needsAction, unreadCount } from "@noshen/engine/queries";
import { Button, Icon, Wordmark } from "@noshen/ui/ui";
import type { IconName } from "@noshen/ui/icons";
import { ThemeToggle } from "@noshen/ui/theme";

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

const TABS: [string, string, IconName][] = [["/browse", "Browse", "search"], ["/deals", "Deals", "receipt"], ["/sell", "Sell", "plus"], ["/notifications", "Alerts", "bell"], ["/account", "Account", "user"]];
const DESKTOP = TABS.filter(([to]) => to !== "/notifications");

export default function AppShell({ loaderData }: Route.ComponentProps) {
  const matches = useMatches();
  const hideTabs = matches.some((m) => (m.handle as { tabs?: boolean } | undefined)?.tabs === false);
  const badge = loaderData.dealsNeedingYou;
  const unread = loaderData.unread;
  const countFor = (to: string) => (to === "/deals" ? badge : to === "/notifications" ? unread : 0);
  return (
    <div className={hideTabs ? "shell" : "shell with-tabs"}>
      <header className="desktop-nav">
        <Link to="/" aria-label="NosHen home" style={{ textDecoration: "none", justifySelf: "start" }}><Wordmark /></Link>
        <nav aria-label="Main">
          {DESKTOP.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === "/browse"} className="navlink">
              <Icon name={icon} size={18} />{label}{label === "Deals" && badge ? <span className="count" aria-label={`, ${badge} need you`}>{badge}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="end">
          <ThemeToggle />
          {loaderData.user ? (
            <Link to="/notifications" className="icon-btn" aria-label={`Notifications${unread ? `, ${unread} new` : ""}`}>
              <Icon name="bell" />{unread ? <span className="dot-count" aria-hidden="true">{unread}</span> : null}
            </Link>
          ) : (
            <Button variant="primary" pill to="/signin">Sign in</Button>
          )}
        </div>
      </header>
      <Outlet />
      {hideTabs ? null : (
        <nav className="tabs" aria-label="Main">
          {TABS.map(([to, label, icon]) => {
            const n = countFor(to);
            return (
              <NavLink key={to} to={to} end={to === "/browse"} className={to === "/sell" ? "tab tab-main" : "tab"} title={label}>
                <Icon name={icon} size={to === "/sell" ? 24 : 22} />
                <span className="tab-label">{label}</span>
                {n ? <span className="badge" aria-label={to === "/deals" ? `${n} deal${n > 1 ? "s" : ""} need you` : `${n} new`}>{n}</span> : null}
              </NavLink>
            );
          })}
        </nav>
      )}
    </div>
  );
}
