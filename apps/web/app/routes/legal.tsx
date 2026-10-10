import { Link, data, useNavigate } from "react-router";
import type { Route } from "./+types/legal";
import { pagePath, withApp } from "../../server/web";
import { settingsOf } from "@noshen/engine/core";
import { isLegalSlug, renderLegal } from "../../server/legal";
import { LEGAL_NAV } from "@noshen/shared/legal-pages";
import { Icon, Info, TopBar } from "@noshen/ui/ui";

export const handle = { tabs: false };

export async function loader({ request }: Route.LoaderArgs) {
  // pagePath drops the ".data" React Router adds when a link loads the page in the background.
  const slug = pagePath(request).split("?")[0].replace(/^\//, "").replace(/\/$/, "");
  if (!isLegalSlug(slug)) throw data("Not found", { status: 404 });
  return withApp(async (d) => ({ slug, ...renderLegal(slug, await settingsOf(d)) }));
}

export const meta: Route.MetaFunction = ({ loaderData: x }) => x ? [
  { title: `${x.title} · NosHen` },
  { name: "description", content: `NosHen ${x.title}.` },
  // Drafts stay out of search results until a lawyer has reviewed them.
  ...(x.draft ? [{ name: "robots", content: "noindex" }] : []),
] : [{ title: "NosHen" }];

export default function Legal({ loaderData: x }: Route.ComponentProps) {
  const navigate = useNavigate();
  // Links inside the document move within the app instead of reloading the page.
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (!a || !href || !href.startsWith("/") || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    navigate(href);
  };
  const others = LEGAL_NAV.filter((p) => p.slug !== x.slug);
  return (
    <div>
      <TopBar title={x.title} back="/" />
      <main className="page legal-page">
        <div className="legal-layout">
          <aside className="legal-side desktop-only" aria-label="Legal and help">
            <nav className="legal-nav" aria-label="Legal pages">
              <p className="label muted">Legal and help</p>
              {LEGAL_NAV.map((p) => (
                <Link key={p.slug} to={`/${p.slug}`} aria-current={p.slug === x.slug ? "page" : undefined}>{p.title}</Link>
              ))}
            </nav>
            {x.toc.length > 2 ? (
              <nav className="legal-toc" aria-label="On this page">
                <p className="label muted">On this page</p>
                {x.toc.map((t) => <a key={t.id} href={`#${t.id}`}>{t.text}</a>)}
              </nav>
            ) : null}
          </aside>
          <article className="legal-doc">
            <h1 className="legal-title">{x.title}</h1>
            {x.draft ? (
              <Info icon="alert-triangle" tone="warn">
                <strong>Draft for legal review.</strong> A Nigerian lawyer hasn't reviewed this yet, and it isn't final.
                {x.hasPlaceholders ? " Highlighted parts are still to be filled in." : ""} It will be completed before NosHen takes real payments.
              </Info>
            ) : null}
            <div className="prose" onClick={onClick} dangerouslySetInnerHTML={{ __html: x.html }} />
            <nav className="legal-more mobile-only" aria-label="More legal and help pages">
              <p className="label muted">More</p>
              {others.map((p) => <Link key={p.slug} to={`/${p.slug}`} className="row-between">{p.title}<Icon name="chevron-right" size={18} /></Link>)}
            </nav>
          </article>
        </div>
      </main>
    </div>
  );
}
