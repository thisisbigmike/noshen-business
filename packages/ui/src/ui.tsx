// The NosHen design system's components, as typed React. Classes and tokens match design-system/.
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes, type MouseEventHandler } from "react";
import { createPortal } from "react-dom";
import { Form, Link, type FormProps } from "react-router";
import { ICONS, type IconName } from "./icons";
import { naira } from "@noshen/shared/money";
import { emailProblem } from "@noshen/shared/validate";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Icon({ name, size = 20, label, className }: { name: IconName; size?: number; label?: string; className?: string }) {
  return (
    <svg className={cx("nh-icon", className)} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {ICONS[name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

/** The favicon's shield on a rounded square, then the name. */
export function Wordmark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`nh-wordmark nh-wordmark-${size}`}>
      <svg className="nh-wordmark-mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="var(--primary)" />
        <g transform="translate(4 4)" fill="none" stroke="var(--on-primary)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          {ICONS["shield-check"].map((d) => <path key={d} d={d} />)}
        </g>
      </svg>
      NosHen
    </span>
  );
}

type BtnProps = {
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md" | "lg";
  block?: boolean;
  pill?: boolean;
  icon?: IconName;
  iconRight?: IconName;
  to?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ variant = "secondary", size = "md", block, pill, icon, iconRight, to, className, children, ...rest }: BtnProps) {
  const cls = cx("nh-btn", `nh-btn-${variant}`, `nh-btn-${size}`, block && "nh-btn-block", pill && "nh-btn-pill", className);
  const inner = <>{icon ? <Icon name={icon} size={18} /> : null}{children}{iconRight ? <Icon name={iconRight} size={18} /> : null}</>;
  // A link can also take a click: for example, to open a sheet in place, with the link as the way there without JavaScript.
  if (to) return <Link to={to} className={cls} onClick={rest.onClick as unknown as MouseEventHandler<HTMLAnchorElement>}>{inner}</Link>;
  return <button type="button" className={cls} {...rest}>{inner}</button>;
}

function FieldMessage({ id, error, hint }: { id: string; error?: string | null; hint?: ReactNode }) {
  if (!error && !hint) return null;
  return (
    <p id={id} className={cx("nh-field-msg caption", error && "nh-field-msg-error")} role={error ? "alert" : undefined}>
      {error ? <Icon name="alert-triangle" size={16} /> : null}{error || hint}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Form checks: NosHen's own messages instead of the browser's bubbles
// ---------------------------------------------------------------------------

const FormErrors = createContext<Record<string, string>>({});

/** The message a CheckedForm is showing for a field, if any. */
export const useFieldError = (name?: string) => {
  const errors = useContext(FormErrors);
  return name ? errors[name] : undefined;
};

type Checkable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** Why a field failed the browser's checks, in words: from the field's own messages first, then sensible defaults. */
function messageFor(el: Checkable): string {
  const v = el.validity;
  const d = el.dataset;
  const type = (el as HTMLInputElement).type;
  if (v.valueMissing) return d.missing ?? (type === "radio" ? "Choose one of these to continue." : "Fill this in to continue.");
  if (v.customError) return el.validationMessage;
  if (v.typeMismatch && type === "email") return emailProblem(el.value) ?? "Check your email address.";
  if (v.tooShort) return `This is too short: use at least ${(el as HTMLInputElement).minLength} characters. You've typed ${el.value.length}.`;
  if (v.tooLong) return `This is too long: use at most ${(el as HTMLInputElement).maxLength} characters.`;
  return d.invalid ?? "Check this field.";
}

/**
 * A React Router Form that, when the browser finds a field it won't send, shows our message under that field
 * instead of the browser's bubble, puts the cursor in the first one, and updates or clears each message as
 * the person fixes it. The server checks everything again.
 */
export function CheckedForm({ children, onChange, ...props }: FormProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const firstAt = useRef(0);
  const onInvalidCapture = (e: FormEvent<HTMLFormElement>) => {
    const el = e.target as Checkable;
    if (!el.name) return;
    e.preventDefault();
    const msg = messageFor(el);
    setErrors((p) => (p[el.name] === msg ? p : { ...p, [el.name]: msg }));
    const now = Date.now();
    if (now - firstAt.current > 400) {
      firstAt.current = now;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.focus({ preventScroll: true });
    }
  };
  const recheck = (e: FormEvent<HTMLFormElement>) => {
    const el = e.target as Checkable;
    if (!el.name || !(el.name in errors)) return;
    setErrors((p) => {
      const next = { ...p };
      if (el.validity.valid) delete next[el.name];
      else next[el.name] = messageFor(el);
      return next;
    });
  };
  return (
    <FormErrors.Provider value={errors}>
      <Form {...props} onInvalidCapture={onInvalidCapture} onChange={(e) => { recheck(e); onChange?.(e); }}>{children}</Form>
    </FormErrors.Provider>
  );
}

/** The message for a group of radio buttons or tiles, shown under the group. */
export function FieldError({ name }: { name: string }) {
  const error = useFieldError(name);
  if (!error) return null;
  return <p className="nh-field-msg nh-field-msg-error caption" role="alert"><Icon name="alert-triangle" size={16} />{error}</p>;
}

type FieldChecks = {
  /** What to say when a required field is empty. */
  missing?: string;
  /** Returns why the value is wrong, or null. Runs as the person types; the form shows it on submit. */
  validate?: (value: string) => string | null;
};

export function TextField({ label, hint, error, className, id, missing, validate, onChange, ...rest }: { label: string; hint?: ReactNode; error?: string | null } & FieldChecks & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const fid = id ?? auto;
  const ref = useRef<HTMLInputElement>(null);
  const shown = useFieldError(rest.name) ?? error;
  // Keep the browser's idea of "valid" in step with our check, including for prefilled and controlled values.
  useEffect(() => { const el = ref.current; if (el && validate) el.setCustomValidity(el.value ? validate(el.value) ?? "" : ""); });
  return (
    <div className={cx("nh-field", shown && "nh-field-error", className)} style={{ maxWidth: "none" }}>
      <label className="nh-field-label label" htmlFor={fid}>{label}</label>
      <input id={fid} ref={ref} className="nh-input" aria-invalid={shown ? true : undefined} aria-describedby={shown || hint ? fid + "-msg" : undefined}
        data-missing={missing} {...rest}
        onChange={(e) => { if (validate) e.currentTarget.setCustomValidity(e.currentTarget.value ? validate(e.currentTarget.value) ?? "" : ""); onChange?.(e); }} />
      <FieldMessage id={fid + "-msg"} error={shown} hint={hint} />
    </div>
  );
}

export function TextArea({ label, hint, error, id, missing, ...rest }: { label: string; hint?: ReactNode; error?: string | null; missing?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId();
  const fid = id ?? auto;
  const shown = useFieldError(rest.name) ?? error;
  return (
    <div className={cx("nh-field", shown && "nh-field-error")} style={{ maxWidth: "none" }}>
      <label className="nh-field-label label" htmlFor={fid}>{label}</label>
      <textarea id={fid} className="nh-input" aria-invalid={shown ? true : undefined} aria-describedby={shown || hint ? fid + "-msg" : undefined} data-missing={missing} {...rest} />
      <FieldMessage id={fid + "-msg"} error={shown} hint={hint} />
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
  const set = (v: string) => { setOwn(v); onChange?.(v); };
  const input = useRef<HTMLInputElement>(null);
  const formError = useFieldError(name);
  const shown = formError ?? error;
  useEffect(() => {
    input.current?.setCustomValidity(value.length > 0 && value.length < length ? `Enter all ${length} digits. You've typed ${value.length}, so ${length - value.length} ${length - value.length === 1 ? "is" : "are"} missing.` : "");
  }, [value, length]);
  // After a wrong code, start fresh: clear the cells, and let the next digit typed into a full field begin again.
  useEffect(() => { if (error) set(""); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  const cells = [];
  for (let i = 0; i < length; i++) {
    cells.push(<span key={i} aria-hidden="true" className={cx("nh-code-cell", i < value.length && "nh-code-cell-filled", i === value.length && "nh-code-cell-active", i === length / 2 && "nh-code-cell-gap")}>{value.charAt(i)}</span>);
  }
  return (
    <div className={cx("nh-code", shown && "nh-code-error")}>
      <label className="nh-field-label label" htmlFor={id}>{label}</label>
      <div className="nh-code-box">
        <input id={id} ref={input} name={name} className="nh-code-input" type="text" inputMode="numeric" autoComplete="one-time-code"
          maxLength={length} value={value} autoFocus={autoFocus} aria-invalid={shown ? true : undefined} aria-describedby={shown || hint ? id + "-msg" : undefined}
          required data-missing={`Enter the ${length}-digit ${label.toLowerCase()}.`}
          onChange={(e) => set(e.target.value.replace(/\D/g, "").slice(0, length))}
          onKeyDown={(e) => { if (error && value.length === length && /^\d$/.test(e.key)) { e.preventDefault(); set(e.key); } }} />
        <div className="nh-code-cells release-code">{cells}</div>
      </div>
      <FieldMessage id={id + "-msg"} error={shown} hint={hint} />
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

export function ProtectionBadge({ variant = "tint", children }: { variant?: "tint" | "brand" | "glass"; children?: ReactNode }) {
  return <span className={`nh-badge nh-badge-${variant} label`}><Icon name="shield-check" size={16} />{children ?? "Protected by NosHen"}</span>;
}

export function ListingCard({ title, priceKobo, area, posted, imageUrl, href }: { title: string; priceKobo: number | string; area?: string; posted?: string; imageUrl?: string; href: string }) {
  const meta = [area, posted].filter(Boolean).join(" · ");
  return (
    <Link className="nh-listing" to={href} prefetch="intent">
      <div className="nh-listing-photo">
        {imageUrl ? <img src={imageUrl} alt="" loading="lazy" decoding="async" /> : <Icon name="camera" size={32} label="No photo yet" />}
        <ProtectionBadge variant="glass">Protected</ProtectionBadge>
      </div>
      <div className="nh-listing-body">
        <p className="nh-listing-title title">{title}</p>
        <p className="nh-listing-price heading">{naira(priceKobo)}</p>
        {meta ? <p className="nh-listing-meta caption"><Icon name="map-pin" size={16} />{meta}</p> : null}
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
  const cls = cx("nh-deal", `nh-deal-${state}`, state === "held" && "beam");
  return href
    ? <Link to={href} prefetch="intent" className={cls} style={{ textDecoration: "none", maxWidth: "none" }} aria-label={`Deal: ${item}`}>{body}</Link>
    : <section className={cls} style={{ maxWidth: "none" }} aria-label={`Deal: ${item}`}>{body}</section>;
}

export function ReleaseCode({ code, defaultRevealed = false, help }: { code: string; defaultRevealed?: boolean; help?: string }) {
  const [shown, setShown] = useState(defaultRevealed);
  return (
    <div className={cx("nh-release", shown ? "nh-release-shown" : "nh-release-hidden")} style={{ maxWidth: "none" }}>
      <p className="nh-release-label label"><Icon name="shield-lock" size={16} />Your release code</p>
      <p className="nh-release-code" aria-live="polite">
        {code.split("").map((c, i) => <span key={`${i}-${shown}`} className="nh-release-digit" aria-hidden="true">{shown ? c : "•"}</span>)}
        <span className="sr-only">{shown ? "Release code " + code.split("").join(" ") : "Release code hidden"}</span>
      </p>
      <Button icon={shown ? "eye-off" : "eye"} onClick={() => setShown(!shown)}>{shown ? "Hide code" : "Show code"}</Button>
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

export interface SelectOption { value: string; label: string; hint?: string }

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The app's own dropdown (a listbox): a panel under the field on wide screens, a bottom sheet on phones.
 * Keyboard: arrows, Home/End, Enter or Space to choose, Escape to close, and type a letter to jump.
 * It posts like a native field through a hidden input; `submitOnChange` sends its form when a choice is made.
 */
export function Select({ name, label, options, defaultValue, value: controlled, onChange, hideLabel, pill, submitOnChange, id }: {
  name: string; label: string; options: SelectOption[]; defaultValue?: string; value?: string; onChange?: (v: string) => void;
  hideLabel?: boolean; pill?: boolean; submitOnChange?: boolean; id?: string;
}) {
  const auto = useId();
  const base = id ?? auto;
  const [own, setOwn] = useState(defaultValue ?? options[0]?.value ?? "");
  const value = controlled ?? own;
  // Follow the page when it changes the starting value (for example, a link that drops ?sort=).
  useEffect(() => { setOwn(defaultValue ?? options[0]?.value ?? ""); }, [defaultValue]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left?: number; right?: number; minWidth?: number }>({});
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const submit = useRef(false);
  const typed = useRef({ text: "", at: 0 });
  const selected = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options[selected];

  const show = (at = selected) => { setActive(at); setOpen(true); };
  const close = (refocus = true) => { setOpen(false); if (refocus) trigger.current?.focus(); };
  const choose = (i: number) => {
    const v = options[i]?.value;
    if (v === undefined) return;
    if (v !== value) { setOwn(v); onChange?.(v); if (submitOnChange) submit.current = true; }
    close();
  };

  // Send the form after the hidden input holds the new value.
  useEffect(() => { if (submit.current) { submit.current = false; hidden.current?.form?.requestSubmit(); } }, [value]);

  // The panel lives at the end of <body> (so nothing on the page can cover or clip it) and is placed against the
  // trigger: below and left-aligned unless that would run off the screen. On phones, CSS makes it a bottom sheet.
  useIsoLayoutEffect(() => {
    if (!open || !trigger.current || !list.current) return;
    const place = () => {
      const t = trigger.current!.getBoundingClientRect();
      const panel = list.current!.parentElement!;
      const h = panel.offsetHeight, w = Math.max(panel.offsetWidth, t.width);
      const up = t.bottom + h + 12 > window.innerHeight && t.top > h + 12;
      const right = t.left + w > window.innerWidth - 8;
      setPos({
        ...(up ? { bottom: window.innerHeight - t.top + 6 } : { top: t.bottom + 6 }),
        ...(right ? { right: Math.max(8, window.innerWidth - t.right) } : { left: t.left }),
        minWidth: t.width,
      });
    };
    place();
    list.current.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);

  // Keep the highlighted option in view by scrolling the list only, never the page.
  useEffect(() => {
    const ul = list.current;
    const li = ul?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    if (!open || !ul || !li) return;
    if (li.offsetTop < ul.scrollTop) ul.scrollTop = li.offsetTop;
    else if (li.offsetTop + li.offsetHeight > ul.scrollTop + ul.clientHeight) ul.scrollTop = li.offsetTop + li.offsetHeight - ul.clientHeight;
  }, [open, active]);

  // A tap or click anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { const n = e.target as Node; if (!root.current?.contains(n) && !list.current?.parentElement?.contains(n)) close(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const onTriggerKey = (e: ReactKeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); show(e.key === "ArrowUp" ? Math.max(0, selected - 1) : selected); }
  };
  const onListKey = (e: ReactKeyboardEvent) => {
    const last = options.length - 1;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(last, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(last); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(active); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") { close(); } // back to the trigger, so Tab carries on from there
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
      const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
    }
  };

  return (
    <div className={cx("nh-field nh-select", pill && "nh-select-pill")} style={{ maxWidth: "none" }} ref={root}>
      <span className={cx("nh-field-label label", hideLabel && "sr-only")} id={base + "-label"}>{label}</span>
      <input type="hidden" name={name} value={value} ref={hidden} />
      <button type="button" ref={trigger} id={base + "-button"} className="nh-select-trigger" aria-haspopup="listbox" aria-expanded={open}
        aria-controls={open ? base + "-list" : undefined} aria-labelledby={`${base}-label ${base}-button`} onClick={() => (open ? close() : show())} onKeyDown={onTriggerKey}>
        <span className="nh-select-value">{current?.label ?? "Choose"}</span>
        <Icon name="chevron-down" size={18} className="nh-select-chev" />
      </button>
      {open ? createPortal(
        <>
          <div className="nh-select-backdrop" aria-hidden="true" onPointerDown={() => close(false)} />
          <div className={cx("nh-select-pop", pos.bottom !== undefined && "up", pos.right !== undefined && "right")} style={pos}>
            <p className="nh-select-head label" aria-hidden="true">{label}</p>
            <ul role="listbox" ref={list} id={base + "-list"} tabIndex={-1} aria-labelledby={base + "-label"}
              aria-activedescendant={`${base}-opt-${active}`} onKeyDown={onListKey}>
              {options.map((o, i) => (
                <li key={o.value} id={`${base}-opt-${i}`} data-i={i} role="option" aria-selected={i === selected}
                  className="nh-option" data-active={i === active} onPointerMove={() => setActive(i)} onClick={() => choose(i)}>
                  <span className="stack" style={{ gap: 0, minWidth: 0 }}>
                    <span>{o.label}</span>
                    {o.hint ? <span className="caption muted">{o.hint}</span> : null}
                  </span>
                  {i === selected ? <Icon name="check" size={18} className="nh-option-check" /> : null}
                </li>
              ))}
            </ul>
          </div>
        </>,
        document.body,
      ) : null}
    </div>
  );
}

/** A photo field that looks like the rest of the app: a tappable area, then how many photos are chosen. */
export function PhotoPicker({ name, label, hint, max = 8 }: { name: string; label: string; hint?: ReactNode; max?: number }) {
  const id = useId();
  const [files, setFiles] = useState<string[]>([]);
  return (
    <div className="nh-field" style={{ maxWidth: "none" }}>
      <span className="nh-field-label label" id={id + "-label"}>{label}</span>
      <label className={cx("photo-picker", files.length > 0 && "has-files")} htmlFor={id}>
        <span className="photo-picker-icon"><Icon name={files.length ? "check" : "camera"} size={22} /></span>
        <span className="stack" style={{ gap: 0, minWidth: 0 }}>
          <span className="body ink">{files.length ? `${files.length} photo${files.length > 1 ? "s" : ""} chosen` : "Add photos"}</span>
          <span className="caption muted photo-picker-names">{files.length ? files.join(", ") : `Up to ${max}. Tap to choose or take them.`}</span>
        </span>
        <input id={id} name={name} type="file" accept="image/*" multiple className="sr-only" aria-labelledby={id + "-label"}
          onChange={(e) => setFiles([...(e.currentTarget.files ?? [])].slice(0, max).map((f) => f.name))} />
      </label>
      {hint ? <p className="nh-field-msg caption">{hint}</p> : null}
    </div>
  );
}

/** Closes a dialog or sheet when Escape is pressed, unless it's busy. */
export function useEscape(open: boolean, close: () => void, busy = false) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]); // eslint-disable-line react-hooks/exhaustive-deps
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

// ---------------------------------------------------------------------------
// Full-screen photo viewer
// ---------------------------------------------------------------------------

/**
 * Shows photos full size on a dark screen, never cropped. Swipe between them on a phone, or use the arrow
 * buttons and keys; ✕ or Escape closes it. `onClose` gets the photo the person ended on.
 */
export function PhotoViewer({ photos, start, label, onClose }: {
  photos: { src: string; alt: string }[]; start: number; label: string; onClose: (at: number) => void;
}) {
  const [at, setAt] = useState(start);
  const track = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const last = photos.length - 1;
  const go = (i: number, smooth = true) => {
    const t = track.current;
    if (!t) return;
    const n = Math.max(0, Math.min(last, i));
    t.scrollTo({ left: n * t.clientWidth, behavior: smooth ? "smooth" : "auto" });
  };
  // Open on the photo that was tapped, keep the page behind still, and put the cursor on ✕.
  useLayoutEffect(() => {
    go(start, false);
    const before = document.activeElement as HTMLElement | null;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    closeBtn.current?.focus();
    return () => { root.style.overflow = overflow; before?.focus?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(at); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(at + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(at - 1); }
      else if (e.key === "Tab") {
        // Keep keyboard focus inside the viewer.
        const items = [...(box.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])];
        if (!items.length) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === items.length - 1 ? 0 : i + 1);
        e.preventDefault();
        items[next].focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at]); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div className="viewer" role="dialog" aria-modal="true" aria-label={label} ref={box}>
      <div className="viewer-bar">
        <span className="viewer-count" aria-live="polite">{at + 1} / {photos.length}</span>
        <button type="button" ref={closeBtn} className="viewer-btn" aria-label="Close photos" onClick={() => onClose(at)}><Icon name="x" size={22} /></button>
      </div>
      <div className="viewer-track" ref={track} onScroll={(e) => setAt(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}>
        {photos.map((p, i) => <div key={p.src + i} className="viewer-slide"><img src={p.src} alt={p.alt} draggable={false} /></div>)}
      </div>
      {photos.length > 1 ? (
        <>
          <button type="button" className="viewer-btn viewer-prev" aria-label="Previous photo" disabled={at === 0} onClick={() => go(at - 1)}><Icon name="arrow-left" size={22} /></button>
          <button type="button" className="viewer-btn viewer-next" aria-label="Next photo" disabled={at === last} onClick={() => go(at + 1)}><Icon name="arrow-right" size={22} /></button>
          <span className="viewer-dots" aria-hidden="true">{photos.map((p, i) => <span key={p.src + i} className={i === at ? "on" : undefined} />)}</span>
        </>
      ) : null}
    </div>,
    document.body,
  );
}
