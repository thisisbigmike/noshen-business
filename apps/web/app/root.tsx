import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/root";
import "@noshen/ui/styles/tokens.css";
import "@noshen/ui/styles/components.css";
import "@noshen/ui/styles/app.css";
import { themeFromCookie, type Theme } from "@noshen/ui/theme";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Sora:wght@600&family=Figtree:wght@400;600&family=IBM+Plex+Mono:wght@500&display=swap" },
];

export function loader({ request }: Route.LoaderArgs) {
  return { theme: themeFromCookie(request.headers.get("Cookie")) };
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

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let details = "Please try again. If it keeps happening, contact NosHen support.";
  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? "We can't find that page" : "Something went wrong";
    details = error.status === 404 ? "The link may be old, or the page may have moved. Try Browse, or go back to the NosHen home page." : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
  }
  return (
    <main className="page narrow" style={{ paddingTop: 48 }}>
      <title>{`${title} · NosHen`}</title>
      <h1 className="heading">{title}</h1>
      <p className="body muted">{details}</p>
      <p><a href="/">Go to NosHen</a></p>
    </main>
  );
}
