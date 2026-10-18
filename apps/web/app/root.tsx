import { useEffect, useRef, useState } from "react";
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useNavigation, useRevalidator, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/root";
import "@noshen/ui/styles/tokens.css";
import "@noshen/ui/styles/components.css";
import "@noshen/ui/styles/app.css";
import { themeFromCookie, type Theme } from "@noshen/ui/theme";
import { canRefresh, failureOf, useRecover } from "@noshen/ui/recover";
import { Button } from "@noshen/ui/ui";
import { pushFor } from "@noshen/engine/context";
import { LANG_INFO, langFromRequest, loadCatalog, msg, type Lang } from "@noshen/shared/i18n";
import { liteFromRequest } from "@noshen/shared/data-saver";
import { marketFromRequest } from "@noshen/shared/locations";
import { cleanCountry } from "@noshen/shared/payments";
import { PrefsProvider, useLite, useT } from "@noshen/ui/i18n";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "manifest", href: "/manifest.webmanifest" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const cookie = request.headers.get("Cookie");
  const lang = langFromRequest(cookie, request.headers.get("Accept-Language"));
  await loadCatalog(lang);
  // Where the visitor is, from Cloudflare (workers/app.ts). ?from=KE pretends, to try another country's view.
  const from = cleanCountry(new URL(request.url).searchParams.get("from")) ?? cleanCountry(request.headers.get("x-noshen-country"));
  return {
    theme: themeFromCookie(cookie), pushKey: pushFor()?.publicKey ?? null,
    lang, lite: liteFromRequest(cookie, request.headers.get("Save-Data")),
    from, market: marketFromRequest(cookie, from),
  };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const root = useRouteLoaderData("root") as { theme?: Theme; lang?: Lang; lite?: boolean; market?: string; from?: string | null } | undefined;
  const theme: Theme = root?.theme ?? "light";
  const lang: Lang = root?.lang ?? "en";
  const lite = root?.lite ?? false;
  return (
    <html lang={LANG_INFO[lang].html} data-lang={lang} data-theme={theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#0f6e56" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="NosHen" />
        <meta name="color-scheme" content={theme} />
        {/* Web fonts are left out with data saver on: the pages fall back to the phone's own fonts. */}
        {lite ? null : <>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@600&family=Figtree:wght@400;600&family=IBM+Plex+Mono:wght@500&display=swap" />
        </>}
        <Meta />
        <Links />
      </head>
      <body>
        <PrefsProvider lang={lang} lite={lite} market={root?.market ?? "NG"} from={root?.from ?? null}>{children}</PrefsProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  useLiveUpdates();
  return <><NavProgress /><Outlet /></>;
}

/**
 * Keeps what's on screen current. The service worker (public/sw.js) shows notifications on this device; when one
 * arrives while NosHen is open, the page reloads its data straight away (the bell, a deal's state). Without
 * notifications, the page still checks every 30 seconds while it's in front, and when the person comes back to it.
 */
function useLiveUpdates() {
  const revalidator = useRevalidator();
  // Data saver: check every 2 minutes instead of every 30 seconds (each check downloads the page's data again).
  const every = useLite() ? 120_000 : 30_000;
  const r = useRef(revalidator);
  r.current = revalidator;
  useEffect(() => {
    // Only while the tab is in front and online: a refresh that can't reach NosHen would show an error page.
    const refresh = () => { if (canRefresh() && r.current.state === "idle") r.current.revalidate(); };
    // Back to the tab: wait a moment, so a computer or phone that has just woken up has its connection back first.
    let wake: ReturnType<typeof setTimeout> | undefined;
    const onShow = () => { clearTimeout(wake); if (document.visibilityState === "visible") wake = setTimeout(refresh, 1500); };
    let sw: ServiceWorkerContainer | null = null;
    const onMessage = (e: MessageEvent) => { if (e.data?.type === "noshen:update") refresh(); };
    if ("serviceWorker" in navigator) {
      sw = navigator.serviceWorker;
      sw.register("/sw.js").catch(() => {});
      sw.addEventListener("message", onMessage);
    }
    // Android offers to install NosHen as an app: keep the offer for the "Install the NosHen app" button.
    const onInstallable = (e: Event) => {
      e.preventDefault();
      (window as { __noshenInstall?: Event }).__noshenInstall = e;
      window.dispatchEvent(new Event("noshen:installable"));
    };
    window.addEventListener("beforeinstallprompt", onInstallable);
    const id = setInterval(refresh, every);
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("online", onShow);
    return () => {
      clearInterval(id); clearTimeout(wake);
      document.removeEventListener("visibilitychange", onShow); window.removeEventListener("online", onShow);
      sw?.removeEventListener("message", onMessage); window.removeEventListener("beforeinstallprompt", onInstallable);
    };
  }, [every]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * A thin bar along the top while the next page loads. It waits a moment first, so a quick move between pages
 * shows nothing; a slow one (a weak connection) shows the app is working, then fills and fades when it's done.
 */
function NavProgress() {
  const busy = useNavigation().state !== "idle";
  const [phase, setPhase] = useState<"idle" | "on" | "done">("idle");
  useEffect(() => {
    if (busy) {
      const t = setTimeout(() => setPhase("on"), 150);
      return () => clearTimeout(t);
    }
    setPhase((p) => (p === "on" ? "done" : "idle"));
  }, [busy]);
  useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(() => setPhase("idle"), 450);
    return () => clearTimeout(t);
  }, [phase]);
  return <div className={phase === "idle" ? "nav-progress" : `nav-progress ${phase}`} aria-hidden="true" />;
}

const FAILURE_TEXT = {
  offline: [msg("Can't reach NosHen"), msg("Check your connection. This page comes back by itself as soon as you're online.")],
  update: [msg("NosHen has been updated"), msg("Loading the new version…")],
  missing: [msg("We can't find that page"), msg("The link may be old, or the page may have moved. Try Browse, or go back to the NosHen home page.")],
  broken: [msg("Something went wrong"), msg("Please try again. If it keeps happening, contact NosHen support.")],
};

/** The error page. When the cause was the connection or an update, it puts itself right (see useRecover). */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const t = useT();
  const failure = failureOf(error);
  const { retry, retrying } = useRecover(failure);
  const [title, fallback] = FAILURE_TEXT[failure].map((x) => t(x));
  let details: string = fallback;
  if (failure === "broken" && isRouteErrorResponse(error) && error.statusText) details = error.statusText;
  else if (failure === "broken" && import.meta.env.DEV && error instanceof Error) details = error.message;
  return (
    <main className="page narrow" style={{ paddingTop: 48 }}>
      <title>{`${title} · NosHen`}</title>
      <h1 className="heading">{title}</h1>
      <p className="body muted">{details}</p>
      <div className="row wrap" style={{ gap: 16, alignItems: "center", marginTop: 8 }}>
        {failure !== "missing" ? (
          <Button variant="primary" onClick={failure === "update" ? () => location.reload() : retry} disabled={retrying}>{retrying ? t("Trying again…") : t("Try again")}</Button>
        ) : null}
        <a href="/">{t("Go to NosHen")}</a>
      </div>
    </main>
  );
}
