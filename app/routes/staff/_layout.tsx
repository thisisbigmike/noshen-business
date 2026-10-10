import { Form, NavLink, Outlet } from "react-router";
import type { Route } from "./+types/_layout";
import { requireStaff, withApp } from "../../../server/web";
import { staffQueues } from "../../../server/engine/queries";
import { Button, Icon, Wordmark } from "../../components/ui";
import type { IconName } from "../../components/icons";
import { ThemeToggle } from "../../components/theme";

export async function loader({ request }: Route.LoaderArgs) {
  const staff = await requireStaff(request);
  const q = await withApp((d) => staffQueues(d.db));
  const waiting = q.disputes.length + q.holds.length + q.locked.length + q.stuck.length + q.failed.length;
  return { staff, waiting };
}

const SECTIONS: { title: string; links: { to: string; label: string; icon: IconName; end?: boolean; count?: boolean }[] }[] = [
  { title: "Work", links: [{ to: "/staff", label: "Dashboard", icon: "layout-dashboard", end: true, count: true }] },
  { title: "Marketplace", links: [{ to: "/staff/listings", label: "Listings", icon: "tag" }, { to: "/staff/users", label: "People", icon: "users" }] },
  { title: "Records", links: [{ to: "/staff/money", label: "Money", icon: "cash" }, { to: "/staff/audit", label: "Audit log", icon: "history" }] },
];

export default function StaffLayout({ loaderData: { staff, waiting } }: Route.ComponentProps) {
  const initials = staff.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const link = (l: (typeof SECTIONS)[number]["links"][number]) => (
    <NavLink key={l.to} to={l.to} end={l.end} className="item" prefetch="intent">
      <Icon name={l.icon} size={20} /><span className="grow">{l.label}</span>
      {l.count && waiting ? <span className="count" aria-label={`${waiting} waiting`}>{waiting}</span> : null}
    </NavLink>
  );
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
        <Form method="post" action="/staff/signout"><Button type="submit" icon="logout" block>Sign out</Button></Form>
      </aside>

      {/* Phones and tablets: a top bar and a row of pill links instead of the side menu. */}
      <header className="console-top">
        <div className="row-between"><div className="console-brand"><Wordmark size="sm" /><span className="console-tag">Staff</span></div>
          <div className="row"><ThemeToggle /><Form method="post" action="/staff/signout"><button type="submit" className="icon-btn" aria-label="Sign out"><Icon name="logout" /></button></Form></div>
        </div>
        <nav className="console-pills" aria-label="Console">{SECTIONS.flatMap((s) => s.links).map(link)}</nav>
      </header>

      <main className="console-main"><Outlet /></main>
    </div>
  );
}
