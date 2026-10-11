// Times are shown in Nigeria time (WAT, the Africa/Lagos time zone), in the short style the screens use: "6:40pm today", "Fri 6pm".

const TZ = "Africa/Lagos";

function parts(d: Date) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, year: "numeric",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return p;
}

const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

export function clock(d: Date): string {
  const p = parts(d);
  const ap = (p.dayPeriod || "").toLowerCase().replace(/\./g, "").replace(/\s/g, "");
  return p.minute === "00" ? `${p.hour}${ap}` : `${p.hour}:${p.minute}${ap}`;
}

/** "6:40pm today", "6pm tomorrow", "Fri 6pm" (within a week), else "12 Sep". */
export function when(d: Date | string, now: Date = new Date()): string {
  const t = typeof d === "string" ? new Date(d) : d;
  const p = parts(t);
  const days = Math.round((Date.parse(dayKey(t)) - Date.parse(dayKey(now))) / 86400000);
  if (days === 0) return `${clock(t)} today`;
  if (days === 1) return `${clock(t)} tomorrow`;
  if (days === -1) return `yesterday ${clock(t)}`;
  if (days > 1 && days < 7) return `${p.weekday} ${clock(t)}`;
  if (days < -1 && days > -7) return `${p.weekday} ${clock(t)}`;
  return `${p.day} ${p.month}`;
}

/** "3 hours ago", "Yesterday", "2 days ago", for listing ages. */
export function ago(d: Date | string, now: Date = new Date()): string {
  const t = typeof d === "string" ? new Date(d) : d;
  const mins = Math.max(0, Math.round((now.getTime() - t.getTime()) / 60000));
  if (mins < 60) return mins <= 1 ? "Just now" : `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  const p = parts(t);
  return `${p.day} ${p.month}`;
}

/** "1 day 4 hours left", "3 hours left", "Passed". */
export function left(d: Date | string, now: Date = new Date()): string {
  const t = typeof d === "string" ? new Date(d) : d;
  let mins = Math.round((t.getTime() - now.getTime()) / 60000);
  if (mins <= 0) return "Passed";
  const days = Math.floor(mins / 1440);
  mins -= days * 1440;
  const hours = Math.floor(mins / 60);
  const m = mins - hours * 60;
  const bits = [];
  if (days) bits.push(`${days} day${days > 1 ? "s" : ""}`);
  if (hours) bits.push(`${hours} hour${hours > 1 ? "s" : ""}`);
  if (!days && !hours) bits.push(`${m} minute${m === 1 ? "" : "s"}`);
  return bits.join(" ") + " left";
}

export const addHours = (d: Date, h: number) => new Date(d.getTime() + h * 3600000);
export const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60000);
