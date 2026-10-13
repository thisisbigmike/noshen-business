import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/root";
import "@noshen/ui/styles/tokens.css";
import "@noshen/ui/styles/components.css";
import "@noshen/ui/styles/app.css";
import "./console.css";
import { themeFromCookie, type Theme } from "@noshen/ui/theme";
import { failureOf, useRecover } from "@noshen/ui/recover";
import { Button } from "@noshen/ui/ui";
import { pushFor } from "@noshen/engine/context";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Sora:wght@600&family=Figtree:wght@400;600&family=IBM+Plex+Mono:wght@500&display=swap" },
];

export function loader({ request }: Route.LoaderArgs) {
  return { theme: themeFromCookie(request.headers.get("Cookie")), pushKey: pushFor()?.publicKey ?? null };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const theme: Theme = (useRouteLoaderData("root") as { theme?: Theme } | undefined)?.theme ?? "light";
  return (
    <html lang="en-NG" data-theme={theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#0f6e56" />
        <meta name="color-scheme" content={theme} />
        {/* The staff site never appears in search results. */}
        <meta name="robots" content="noindex, nofollow" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

const FAILURE_TEXT = {
  offline: ["Can't reach NosHen", "Check your connection. This page comes back by itself as soon as you're online."],
  update: ["The staff site has been updated", "Loading the new version…"],
  missing: ["We can't find that page", "The link may be old, or the case may have been closed. Go back to the dashboard."],
  broken: ["Something went wrong", "Please try again. If it keeps happening, tell the NosHen engineering team."],
} as const;

/** The error page. When the cause was the connection or an update, it puts itself right (see useRecover). */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const failure = failureOf(error);
  const { retry, retrying } = useRecover(failure);
  const [title, fallback] = FAILURE_TEXT[failure];
  let details: string = fallback;
  if (failure === "broken" && isRouteErrorResponse(error) && error.statusText) details = error.statusText;
  else if (failure === "broken" && import.meta.env.DEV && error instanceof Error) details = error.message;
  return (
    <main className="auth-page">
      <div className="auth-card">
        <title>{`${title} · NosHen staff`}</title>
        <h1 className="heading">{title}</h1>
        <p className="body muted">{details}</p>
        <div className="row wrap" style={{ gap: 16, alignItems: "center" }}>
          {failure !== "missing" ? (
            <Button variant="primary" onClick={failure === "update" ? () => location.reload() : retry} disabled={retrying}>{retrying ? "Trying again…" : "Try again"}</Button>
          ) : null}
          <a href="/">Go to the dashboard</a>
        </div>
      </div>
    </main>
  );
}
