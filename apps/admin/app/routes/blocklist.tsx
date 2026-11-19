import { Form, useNavigation } from "react-router";
import type { Route } from "./+types/blocklist";
import { messageOf, requireStaff, withApp } from "../../server/web";
import { BLOCKLIST_KINDS, addBlocklistEntry, listBlocklist, removeBlocklistEntry, type BlocklistKind } from "@noshen/engine/blocklist";
import { Button, ErrorText, Info, Select, TextField } from "@noshen/ui/ui";
import { when } from "@noshen/shared/time";
import { ReasonAction, type ActionResult } from "../lib/reason-action";

export const meta = () => [{ title: "Blocklist · NosHen staff" }];

export async function loader({ request }: Route.LoaderArgs) {
  const staff = await requireStaff(request);
  return withApp(async (d) => ({
    entries: await listBlocklist(d.db),
    isAdmin: staff.role === "admin",
  }));
}

export async function action({ request }: Route.ActionArgs): Promise<ActionResult> {
  const staff = await requireStaff(request);
  const f = await request.formData();
  const intent = String(f.get("intent") ?? "");
  try {
    if (intent === "add") {
      await withApp((d) =>
        addBlocklistEntry(d, staff, {
          kind: String(f.get("kind")) as BlocklistKind,
          value: String(f.get("value") ?? ""),
          reason: String(f.get("reason") ?? ""),
        }),
      );
      return { ok: true, intent, message: "Added to the blocklist and recorded in the audit log." };
    }
    if (intent === "remove") {
      await withApp((d) => removeBlocklistEntry(d, staff, String(f.get("id") ?? ""), String(f.get("reason") ?? "")));
      return { ok: true, intent, message: "Removed from the active blocklist." };
    }
    return { ok: false, intent, error: "Unknown action." };
  } catch (e) {
    return { ok: false, intent, error: messageOf(e) };
  }
}

const KIND_LABEL: Record<string, string> = Object.fromEntries([...BLOCKLIST_KINDS, ["device", "Device"]]);

export default function Blocklist({ loaderData: { entries, isAdmin }, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  return (
    <>
      <header className="console-head">
        <div>
          <h1 className="heading">Scammer & stolen-device blocklist</h1>
          <p className="caption muted">Values are stored as salted HMACs only. Blocking a bank account, NIN/BVN, IMEI/VIN or social handle stops a scammer from signing up again under a new email.</p>
        </div>
      </header>

      <div className="console-grid">
        <section className="panel stack">
          <h2 className="title">Active blocklist ({entries.length})</h2>
          {entries.length === 0 ? (
            <p className="caption muted">Nothing on the blocklist yet.</p>
          ) : (
            <div className="stack">
              {entries.map((e) => (
                <div key={e.id} className="kv" style={{ alignItems: "flex-start", gap: 12 }}>
                  <div className="stack" style={{ gap: 2 }}>
                    <span className="label">{KIND_LABEL[e.kind] ?? e.kind}: {e.label ?? "Masked"}</span>
                    <span className="body">{e.reason}</span>
                    <span className="caption muted">Added by {e.added_by_name ?? "Staff"} · {when(new Date(e.at))}</span>
                  </div>
                  {isAdmin ? (
                    <ReasonAction intent="remove" hidden={{ id: e.id }} label="Remove" help="Lifts this blocklist entry. Kept in the audit log." />
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="stack-4">
          <section className="panel stack">
            <h2 className="title">Block an identifier</h2>
            <Form method="post" className="stack">
              <input type="hidden" name="intent" value="add" />
              <Select
                name="kind"
                label="Type"
                defaultValue="bank_account"
                options={BLOCKLIST_KINDS.map(([value, label]) => ({ value, label }))}
              />
              <TextField label="Value" name="value" placeholder="Account number, NIN, IMEI or @handle" required />
              <TextField label="Reason" name="reason" placeholder="Why this is blocked (kept in audit log)" minLength={5} required />
              {actionData?.intent === "add" && actionData.ok ? <Info icon="circle-check">{actionData.message}</Info> : null}
              <ErrorText>{actionData?.intent === "add" && !actionData.ok ? actionData.error : null}</ErrorText>
              <Button type="submit" variant="primary" icon="shield-off" disabled={busy}>
                {busy ? "Blocking…" : "Add to blocklist"}
              </Button>
            </Form>
          </section>
        </aside>
      </div>
    </>
  );
}
