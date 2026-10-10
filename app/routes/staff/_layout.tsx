import { Form, NavLink, Outlet } from "react-router";
import type { Route } from "./+types/_layout";
import { requireStaff, withApp } from "../../../server/web";
import { staffQueues } from "../../../server/engine/queries";
import { Button, Icon, Wordmark } from "../../components/ui";
import { ThemeToggle } from "../../components/theme";

export async function loader({ request }: Route.LoaderArgs) {
  const staff = await requireStaff(request);
  const q = await withApp((d) => staffQueues(d.db));
  const waiting = q.disputes.length + q.holds.length + q.locked.length + q.stuck.length + q.failed.length;
  return { staff, waiting };
}

export default function StaffLayout({ loaderData: { staff, waiting } }: Route.ComponentProps) {
  return (
    <div className="console">
      <aside className="console-nav">
        <div className="stack"><Wordmark size="md" /><span className="caption muted">Staff console</span></div>
        <nav className="stack" aria-label="Console">
          <NavLink to="/staff" end className="item"><span className="row"><Icon name="list-check" />Queues</span>{waiting ? <span className="count">{waiting}</span> : null}</NavLink>
          <NavLink to="/staff/money" className="item"><span className="row"><Icon name="cash" />Money</span></NavLink>
          <NavLink to="/staff/audit" className="item"><span className="row"><Icon name="history" />Audit log</span></NavLink>
        </nav>
        <span className="grow" />
        <div className="row-between"><span className="caption muted">Theme</span><ThemeToggle /></div>
        <div className="stack">
          <p className="label">{staff.name}</p>
          <p className="caption muted">{staff.role === "admin" ? "Admin" : "Reviewer"} · {staff.email}</p>
          <Form method="post" action="/staff/signout"><Button type="submit" icon="logout">Sign out</Button></Form>
        </div>
      </aside>
      <main className="console-main"><Outlet /></main>
    </div>
  );
}
