import { Form, NavLink, Outlet } from "react-router";
import type { Route } from "./+types/_layout";
import { requireStaff, withApp } from "../../server/web";
import { staffCounts } from "@noshen/engine/queries";
import { useLive } from "../lib/live";
import { Button, Icon, Wordmark } from "@noshen/ui/ui";
import type { IconName } from "@noshen/ui/icons";
import { ThemeToggle } from "@noshen/ui/theme";

export async function loader({ request }: Route.LoaderArgs) {
  const staff = await requireStaff(request);
  const counts = await withApp((d) => staffCounts(d.db));
  return { staff, counts };
}

type Counts = Route.ComponentProps["loaderData"]["counts"];
const SECTIONS: { title: string; links: { to: string; label: string; icon: IconName; end?: boolean; count?: (c: Counts) => number }[] }[] = [
  { title: "Work", links: [
    { to: "/", label: "Dashboard", icon: "layout-dashboard", end: true },
    { to: "/disputes", label: "Disputes", icon: "scale", count: (c) => c.disputes },
    { to: "/holds", label: "Review holds", icon: "shield-lock", count: (c) => c.holds },
    { to: "/deals", label: "Deals", icon: "receipt", count: (c) => c.locked + c.stuck + c.failed },
  ] },
  { title: "Marketplace", links: [{ to: "/listings", label: "Listings", icon: "tag" }, { to: "/users", label: "People", icon: "users" }] },
  { title: "Records", links: [{ to: "/money", label: "Money", icon: "cash" }, { to: "/audit", label: "Audit log", icon: "history" }] },
];

export default function StaffLayout({ loaderData: { staff, counts } }: Route.ComponentProps) {
  // Every staff page stays current: queues, counts and records reload every 15 seconds while the tab is open.
  useLive(15_000);
  const initials = staff.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const link = (l: (typeof SECTIONS)[number]["links"][number]) => {
    const n = l.count?.(counts) ?? 0;
    return (
      <NavLink key={l.to} to={l.to} end={l.end} className="item" prefetch="intent">
        <Icon name={l.icon} size={20} /><span className="grow">{l.label}</span>
        {n ? <span className="count" aria-label={`${n} waiting`}>{n}</span> : null}
      </NavLink>
    );
  };
  return (
    <div className="console">
      <aside className="console-nav" aria-label="Staff console">
        <div className="console-brand"><Wordmark size="md" /><span className="console-tag">Staff</span></div>
        <nav className="console-links" aria-label="Console">
          {SECTIONS.map((s) => (
            <div key={s.title} className="console-group"><p className="console-group-title">{s.title}</p>{s.links.map(link)}</div>
          ))}
        </nav>
        <div className="console-me">
          <span className="avatar" aria-hidden="true">{initials}</span>
          <div className="grow" style={{ minWidth: 0 }}>
            <p className="label truncate">{staff.name}</p>
            <p className="caption muted truncate">{staff.role === "admin" ? "Admin" : "Reviewer"} · {staff.email}</p>
          </div>
          <ThemeToggle />
        </div>
        <Form method="post" action="/signout"><Button type="submit" icon="logout" block>Sign out</Button></Form>
      </aside>

      {/* Phones and tablets: a top bar and a row of pill links instead of the side menu. */}
      <header className="console-top">
        <div className="row-between"><div className="console-brand"><Wordmark size="sm" /><span className="console-tag">Staff</span></div>
          <div className="row"><ThemeToggle /><Form method="post" action="/signout"><button type="submit" className="icon-btn" aria-label="Sign out"><Icon name="logout" /></button></Form></div>
        </div>
        <nav className="console-pills" aria-label="Console">{SECTIONS.flatMap((s) => s.links).map(link)}</nav>
      </header>

      <main className="console-main"><Outlet /></main>
    </div>
  );
}
