// The NosHen design system's components, as typed React. Classes and tokens match design-system/.
import { useId, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Link } from "react-router";
import { ICONS, type IconName } from "./icons";
import { naira } from "../../shared/money";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Icon({ name, size = 20, label, className }: { name: IconName; size?: number; label?: string; className?: string }) {
  return (
    <svg className={cx("nh-icon", className)} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {ICONS[name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

export function Wordmark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return <span className={`nh-wordmark nh-wordmark-${size}`}>NosHen</span>;
}

type BtnProps = {
  variant?: "primary" | "secondary" | "danger";
  size?: "md" | "lg";
  block?: boolean;
  icon?: IconName;
  to?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ variant = "secondary", size = "md", block, icon, to, className, children, ...rest }: BtnProps) {
  const cls = cx("nh-btn", `nh-btn-${variant}`, `nh-btn-${size}`, block && "nh-btn-block", className);
  const inner = <>{icon ? <Icon name={icon} size={18} /> : null}{children}</>;
  if (to) return <Link to={to} className={cls} style={{ textDecoration: "none" }}>{inner}</Link>;
  return <button type="button" className={cls} {...rest}>{inner}</button>;
}

function FieldMessage({ id, error, hint }: { id: string; error?: string | null; hint?: ReactNode }) {
  if (!error && !hint) return null;
  return (
    <p id={id} className={cx("nh-field-msg caption", error && "nh-field-msg-error")}>
      {error ? <Icon name="alert-triangle" size={16} /> : null}{error || hint}
    </p>
  );
}

export function TextField({ label, hint, error, className, id, ...rest }: { label: string; hint?: ReactNode; error?: string | null } & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={cx("nh-field", error && "nh-field-error", className)} style={{ maxWidth: "none" }}>
      <label className="nh-field-label label" htmlFor={fid}>{label}</label>
      <input id={fid} className="nh-input" aria-invalid={error ? true : undefined} aria-describedby={error || hint ? fid + "-msg" : undefined} {...rest} />
      <FieldMessage id={fid + "-msg"} error={error} hint={hint} />
    </div>
  );
}

export function TextArea({ label, hint, error, id, ...rest }: { label: string; hint?: ReactNode; error?: string | null } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={cx("nh-field", error && "nh-field-error")} style={{ maxWidth: "none" }}>
      <label className="nh-field-label label" htmlFor={fid}>{label}</label>
      <textarea id={fid} className="nh-input" {...rest} />
      <FieldMessage id={fid + "-msg"} error={error} hint={hint} />
    </div>
  );
}

/** One real input under six visual cells. Works with paste and SMS autofill. */
export function CodeInput({ name, label = "Release code", hint, error, length = 6, autoFocus, value: controlled, onChange }: {
  name: string; label?: string; hint?: ReactNode; error?: string | null; length?: number; autoFocus?: boolean; value?: string; onChange?: (v: string) => void;
}) {
  const id = useId();
  const [own, setOwn] = useState("");
  const value = (controlled ?? own).replace(/\D/g, "").slice(0, length);
  const cells = [];
  for (let i = 0; i < length; i++) {
    cells.push(<span key={i} aria-hidden="true" className={cx("nh-code-cell", i < value.length && "nh-code-cell-filled", i === length / 2 && "nh-code-cell-gap")}>{value.charAt(i)}</span>);
  }
  return (
    <div className={cx("nh-code", error && "nh-code-error")}>
      <label className="nh-field-label label" htmlFor={id}>{label}</label>
      <div className="nh-code-box">
        <input id={id} name={name} className="nh-code-input" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*"
          maxLength={length} value={value} autoFocus={autoFocus} aria-invalid={error ? true : undefined}
          onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, length); setOwn(v); onChange?.(v); }} />
        <div className="nh-code-cells release-code">{cells}</div>
      </div>
      <FieldMessage id={id + "-msg"} error={error} hint={hint} />
    </div>
  );
}

const STATES = {
  awaiting: { icon: "clock", word: "Awaiting payment" },
  held: { icon: "lock", word: "Held" },
  released: { icon: "circle-check", word: "Released" },
  dispute: { icon: "alert-triangle", word: "Dispute" },
  refunded: { icon: "arrow-back-up", word: "Refunded" },
} as const;

export type MoneyState = keyof typeof STATES;

export function MoneyStatus({ state, children }: { state: MoneyState; children?: ReactNode }) {
  const s = STATES[state] ?? STATES.awaiting;
  return <span className={`nh-status nh-status-${state} label`}><Icon name={s.icon} size={16} />{children ?? s.word}</span>;
}

export function ProtectionBadge({ variant = "tint", children }: { variant?: "tint" | "brand"; children?: ReactNode }) {
  return <span className={`nh-badge nh-badge-${variant} label`}><Icon name="shield-check" size={16} />{children ?? "Protected by NosHen"}</span>;
}

export function ListingCard({ title, priceKobo, area, posted, imageUrl, href }: { title: string; priceKobo: number | string; area?: string; posted?: string; imageUrl?: string; href: string }) {
  const meta = [area, posted].filter(Boolean).join(" · ");
  return (
    <Link className="nh-listing" to={href}>
      <div className="nh-listing-photo">{imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : <Icon name="camera" size={32} label="No photo yet" />}</div>
      <div className="nh-listing-body">
        <p className="nh-listing-title title">{title}</p>
        <p className="nh-listing-price heading">{naira(priceKobo)}</p>
        {meta ? <p className="nh-listing-meta caption"><Icon name="map-pin" size={16} />{meta}</p> : null}
        <ProtectionBadge />
      </div>
    </Link>
  );
}

export function DealCard({ state, word, amountKobo, item, counterpart, deadline, nextStep, href, children }: {
  state: MoneyState; word?: string; amountKobo: number | string; item: string; counterpart?: string; deadline?: string; nextStep?: string; href?: string; children?: ReactNode;
}) {
  const body = (
    <>
      <div className="nh-deal-top">
        <MoneyStatus state={state}>{word}</MoneyStatus>
        {deadline ? <span className="nh-deal-deadline caption"><Icon name="clock" size={16} />{deadline}</span> : null}
      </div>
      <p className="nh-deal-amount display">{naira(amountKobo)}</p>
      <p className="nh-deal-item body">{item}{counterpart ? <span className="nh-deal-who"> · {counterpart}</span> : null}</p>
      {nextStep ? <p className="nh-deal-next body">{nextStep}</p> : null}
      {children ? <div className="nh-deal-actions">{children}</div> : null}
    </>
  );
  return href
    ? <Link to={href} className="nh-deal" style={{ textDecoration: "none", maxWidth: "none" }} aria-label={`Deal: ${item}`}>{body}</Link>
    : <section className="nh-deal" style={{ maxWidth: "none" }} aria-label={`Deal: ${item}`}>{body}</section>;
}

export function ReleaseCode({ code, defaultRevealed = false, help }: { code: string; defaultRevealed?: boolean; help?: string }) {
  const [shown, setShown] = useState(defaultRevealed);
  const half = Math.ceil(code.length / 2);
  return (
    <div className="nh-release" style={{ maxWidth: "none" }}>
      <p className="nh-release-label label">Your release code</p>
      <p className="nh-release-code release-code" aria-live="polite" aria-label={shown ? "Release code " + code.split("").join(" ") : "Release code hidden"}>
        {shown ? code.slice(0, half) + " " + code.slice(half) : "••• •••"}
      </p>
      <Button onClick={() => setShown(!shown)}>{shown ? "Hide code" : "Show code"}</Button>
      <p className="nh-release-help caption">{help ?? "Give this code to the seller only after you have checked the item. It releases your money."}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App chrome
// ---------------------------------------------------------------------------

export function TopBar({ title, back, right }: { title: ReactNode; back?: string; right?: ReactNode }) {
  return (
    <header className="topbar mobile-only">
      {back ? <Link className="icon-btn" to={back} aria-label="Back"><Icon name="arrow-left" /></Link> : <span style={{ width: 8 }} />}
      <h1 className="title title">{title}</h1>
      {right}
    </header>
  );
}

export function BottomAction({ children, staticOnDesktop = true }: { children: ReactNode; staticOnDesktop?: boolean }) {
  return <div className={cx("bottom-action", staticOnDesktop && "desktop-static")}><div className="inner">{children}</div></div>;
}

export function Info({ icon = "info-circle", tone, children }: { icon?: IconName; tone?: "warn" | "danger"; children: ReactNode }) {
  return <div className={cx("info", tone)}><Icon name={icon} size={20} /><div className="grow">{children}</div></div>;
}

export function Kv({ k, v, total }: { k: ReactNode; v: ReactNode; total?: boolean }) {
  return <div className={cx("kv", total && "total")}><span className={total ? "" : "muted"}>{k}</span><span className="tabular">{v}</span></div>;
}

export interface Step { label: string; when?: string; status: "done" | "now" | "todo" }

export function Timeline({ steps }: { steps: Step[] }) {
  return (
    <ol className="timeline">
      {steps.map((s, i) => (
        <li key={i} className={s.status}>
          <span className="dot">{s.status === "done" ? <Icon name="check" size={12} /> : null}</span>
          <div><p className="label body">{s.label}</p>{s.when ? <p className="caption muted">{s.when}</p> : null}</div>
        </li>
      ))}
    </ol>
  );
}

export function Avatar({ name }: { name: string }) {
  return <span className="avatar" aria-hidden="true">{(name.trim()[0] ?? "?").toUpperCase()}</span>;
}

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="caption error-text row" role="alert"><Icon name="alert-triangle" size={16} />{children}</p>;
}
