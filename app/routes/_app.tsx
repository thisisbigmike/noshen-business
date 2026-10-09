import { Link, NavLink, Outlet, useMatches } from "react-router";
import type { Route } from "./+types/_app";
import { optionalUser, withApp } from "../../server/web";
import { dealsFor, needsAction, unreadCount } from "../../server/engine/queries";
import { Icon, Wordmark } from "../components/ui";
import type { IconName } from "../components/icons";

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

const TABS: [string, string, IconName][] = [["/", "Browse", "search"], ["/deals", "Deals", "receipt"], ["/sell", "Sell", "plus"], ["/account", "Account", "user"]];

export default function AppShell({ loaderData }: Route.ComponentProps) {
  const matches = useMatches();
  const hideTabs = matches.some((m) => (m.handle as { tabs?: boolean } | undefined)?.tabs === false);
  const badge = loaderData.dealsNeedingYou;
  return (
    <div className={hideTabs ? "shell" : "shell with-tabs"}>
      <header className="desktop-nav">
        <Link to="/" aria-label="NosHen home" style={{ textDecoration: "none" }}><Wordmark /></Link>
        <nav aria-label="Main">
          {TABS.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"} className="navlink">
              {label}{label === "Deals" && badge ? ` (${badge})` : ""}
            </NavLink>
          ))}
        </nav>
        <span className="grow" />
        {loaderData.user ? (
          <Link to="/notifications" className="icon-btn" aria-label={`Notifications${loaderData.unread ? `, ${loaderData.unread} new` : ""}`}>
            <Icon name="message-circle" />{loaderData.unread ? <span className="caption">{loaderData.unread}</span> : null}
          </Link>
        ) : (
          <Link to="/signin" className="navlink">Sign in</Link>
        )}
      </header>
      <Outlet />
      {hideTabs ? null : (
        <nav className="tabs" aria-label="Main">
          {TABS.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === "/"} className="tab caption">
              <Icon name={icon} size={22} />
              <span>{label}</span>
              {label === "Deals" && badge ? <span className="badge" aria-label={`${badge} deal${badge > 1 ? "s" : ""} need you`}>{badge}</span> : null}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
