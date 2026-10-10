// Light or dark. Light is the default; the choice lives in a cookie so the server sends the right theme
// straight away (no flash of the wrong colours), and every toggle on the page stays in step.
import { useSyncExternalStore } from "react";
import { useRouteLoaderData } from "react-router";
import { Icon } from "./ui";

export type Theme = "light" | "dark";
export const THEME_COOKIE = "noshen-theme";

/** The theme saved in the request's cookie, or light. */
export function themeFromCookie(cookie: string | null): Theme {
  return /(?:^|;\s*)noshen-theme=dark(?:;|$)/.test(cookie ?? "") ? "dark" : "light";
}

const EVENT = "noshen-theme";
const subscribe = (cb: () => void) => { window.addEventListener(EVENT, cb); return () => window.removeEventListener(EVENT, cb); };
const read = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

export function setTheme(next: Theme) {
  const apply = () => {
    document.documentElement.dataset.theme = next;
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", next);
    document.cookie = `${THEME_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    window.dispatchEvent(new Event(EVENT));
  };
  // A soft cross-fade where the browser supports it, unless motion is reduced.
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) doc.startViewTransition(apply);
  else apply();
}

export function useTheme(): Theme {
  const initial = (useRouteLoaderData("root") as { theme?: Theme } | undefined)?.theme ?? "light";
  return useSyncExternalStore(subscribe, read, () => initial);
}

/** A round button: a moon in light mode, a sun in dark mode. */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useTheme();
  const dark = theme === "dark";
  return (
    <button type="button" className={`icon-btn theme-toggle${className ? ` ${className}` : ""}`} aria-pressed={dark} aria-label="Dark theme"
      title={dark ? "Switch to light theme" : "Switch to dark theme"} onClick={() => setTheme(dark ? "light" : "dark")}>
      <span className="theme-icon" data-dark={dark}>
        <Icon name="moon" size={20} className="ti-moon" />
        <Icon name="sun" size={20} className="ti-sun" />
      </span>
    </button>
  );
}

/** Light | Dark, as a two-way switch for settings pages. */
export function ThemeSwitch() {
  const theme = useTheme();
  return (
    <div className="seg theme-seg" role="group" aria-label="Theme">
      {(["light", "dark"] as const).map((t) => (
        <button key={t} type="button" aria-pressed={theme === t} onClick={() => theme !== t && setTheme(t)}>
          <Icon name={t === "light" ? "sun" : "moon"} size={16} />{t === "light" ? "Light" : "Dark"}
        </button>
      ))}
    </div>
  );
}
