import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Link, NavLink, Outlet, useLocation, useMatches } from "react-router";
import type { Route } from "./+types/_app";
import { optionalUser, withApp } from "../../server/web";
import { dealsFor, needsAction, unreadCount } from "@noshen/engine/queries";
import { Button, Icon, Wordmark, useSlideIndicator } from "@noshen/ui/ui";
import type { IconName } from "@noshen/ui/icons";
import { ThemeToggle } from "@noshen/ui/theme";
import { useLang, useT } from "@noshen/ui/i18n";
import { msg } from "@noshen/shared/i18n";
import { LanguageToggle } from "../lib/prefs";
import { CountrySwitch } from "../lib/country";

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

const useIsoLayoutEffect = typeof document !== "undefined" ? useLayoutEffect : useEffect;

function activeTabIndex(pathname: string): number {
  if (pathname === "/browse") return 0;
  if (pathname === "/deals" || pathname.startsWith("/deals/")) return 1;
  if (pathname === "/sell" || pathname.startsWith("/sell/")) return 2;
  if (pathname === "/notifications" || pathname.startsWith("/notifications/")) return 3;
  if (pathname === "/account" || pathname.startsWith("/account/")) return 4;
  return -1;
}

export default function AppShell({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const lang = useLang();
  const { pathname } = useLocation();
  const matches = useMatches();
  const hideTabs = matches.some((m) => (m.handle as { tabs?: boolean } | undefined)?.tabs === false);
  const badge = loaderData.dealsNeedingYou;
  const unread = loaderData.unread;
  const countFor = (to: string) => (to === "/deals" ? badge : to === "/notifications" ? unread : 0);

  const desktopNavRef = useRef<HTMLElement>(null);
  const desktopSlide = useSlideIndicator(desktopNavRef, `${pathname}:${lang}:${badge}`);

  // Mobile bottom pill tab bar: compute exact final target rect from clientWidth so the tint pill glides
  // seamlessly left↔right in lockstep with the expanding active tab label.
  const mobileNavRef = useRef<HTMLElement>(null);
  const tabIdx = activeTabIndex(pathname);
  const [tabBox, setTabBox] = useState({ tx: 6, tw: 0, visible: false, animate: false });
  const tabMounted = useRef(false);
  useIsoLayoutEffect(() => {
    const el = mobileNavRef.current;
    if (!el || hideTabs) return;
    const measure = (animate: boolean) => {
      const w = el.clientWidth;
      if (w <= 0 || tabIdx < 0 || tabIdx === 2) {
        setTabBox((p) => (p.visible ? { ...p, visible: false, animate } : p));
        return;
      }
      const pad = 6;
      const gap = 4;
      const mainW = 54;
      const avail = Math.max(0, w - pad * 2 - mainW - gap * 4);
      const unit = avail / 5.2;
      const tw = unit * 2.2;
      const tx = tabIdx === 0 ? pad : tabIdx === 1 ? pad + unit + gap : tabIdx === 3 ? pad + 2 * (unit + gap) + mainW + gap : pad + 3 * (unit + gap) + mainW + gap;
      setTabBox((p) => {
        if (p.visible && Math.abs(p.tx - tx) < 0.5 && Math.abs(p.tw - tw) < 0.5 && p.animate === animate) return p;
        return { tx, tw, visible: true, animate: animate && p.visible };
      });
    };
    measure(tabMounted.current);
    tabMounted.current = true;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measure(false)) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [tabIdx, hideTabs]);

  const tabSliderStyle: CSSProperties | undefined = tabBox.visible
    ? ({ ["--tx" as string]: `${tabBox.tx}px`, ["--tw" as string]: `${tabBox.tw}px` })
    : undefined;

  return (
    <div className={hideTabs ? "shell" : "shell with-tabs"}>
      <header className="desktop-nav">
        <Link to="/" prefetch="intent" aria-label={t("NosHen home")} style={{ textDecoration: "none", justifySelf: "start" }}><Wordmark /></Link>
        <nav ref={desktopNavRef} aria-label="Main" {...desktopSlide.props}>
          {desktopSlide.pill}
          {DESKTOP.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === "/browse"} className="navlink" prefetch="intent">
              <Icon name={icon} size={18} />{t(label)}{to === "/deals" && badge ? <span className="count" aria-label={t(", {n} need you", { n: badge })}>{badge}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="end">
          <CountrySwitch />
          <LanguageToggle />
          <ThemeToggle />
          {loaderData.user ? (
            <>
              <NavLink to="/saved" className="icon-btn" title={t("Saved items")} aria-label={t("Saved items")} prefetch="intent">
                <Icon name="heart" />
              </NavLink>
              <NavLink to="/notifications" className="icon-btn" title={t("Notifications")} aria-label={unread ? t("Notifications, {n} new", { n: unread }) : t("Notifications")}>
                <Icon name="bell" />{unread ? <span className="dot-count" aria-hidden="true">{unread}</span> : null}
              </NavLink>
            </>
          ) : (
            <Button variant="primary" pill to="/signin">{t("Sign in")}</Button>
          )}
        </div>
      </header>
      <Outlet />
      {hideTabs ? null : (
        <nav ref={mobileNavRef} className="tabs" aria-label="Main"
          data-sliding={tabBox.visible ? "true" : undefined}
          data-sliding-anim={tabBox.animate ? "true" : undefined}
          style={tabSliderStyle}>
          <span className="tabs-slider" aria-hidden="true" />
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
