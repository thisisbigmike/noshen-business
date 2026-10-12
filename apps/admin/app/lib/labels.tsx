// How deal states and staff actions read on the staff site.

export const DEAL_STATE: Record<string, { label: string; tone: string }> = {
  requested: { label: "Requested", tone: "brand" },
  accepted: { label: "Waiting for payment", tone: "brand" },
  held: { label: "Money held", tone: "warn" },
  disputed: { label: "Disputed", tone: "bad" },
  released: { label: "Released", tone: "ok" },
  paid_out: { label: "Paid out", tone: "ok" },
  refunded: { label: "Refunded", tone: "muted" },
  declined: { label: "Ended", tone: "muted" },
};

export const ACCOUNT_STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: "Active", tone: "ok" }, frozen: { label: "Frozen", tone: "warn" }, banned: { label: "Banned", tone: "bad" },
};

export const TRANSFER_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Waiting", tone: "muted" }, sent: { label: "Sent", tone: "brand" }, succeeded: { label: "Done", tone: "ok" },
  failed: { label: "Failed", tone: "bad" }, reversed: { label: "Reversed", tone: "bad" },
};

/** "freeze_user" → "Freeze user" */
export const actionLabel = (a: string) => a.charAt(0).toUpperCase() + a.slice(1).replace(/_/g, " ");

export function StatePill({ map, value }: { map: Record<string, { label: string; tone: string }>; value: string }) {
  const s = map[value] ?? { label: value, tone: "muted" };
  return <span className={`st-pill ${s.tone}`}>{s.label}</span>;
}
