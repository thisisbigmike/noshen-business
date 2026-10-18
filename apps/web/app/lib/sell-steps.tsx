// Where a seller is in listing something: What → Photos → Details → Publish. Steps already done are links back.
import { Link } from "react-router";
import { Icon } from "@noshen/ui/ui";
import { useT } from "@noshen/ui/i18n";
import { msg } from "@noshen/shared/i18n";

const STEPS = [msg("What"), msg("Photos"), msg("Details"), msg("Publish")];

/** `at` is the step the seller is on, 1 to 4. `id` is the draft's id, once there is one, for the links back. */
export function SellSteps({ at, id }: { at: 1 | 2 | 3 | 4; id?: string }) {
  const t = useT();
  const to = (n: number) => (n === 1 ? "/sell" : id ? `/sell/${id}/${n === 2 ? "photos" : "details"}` : null);
  return (
    <ol className="sell-steps" aria-label={t("Step {n} of {total}", { n: at, total: STEPS.length })}>
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < at ? "done" : n === at ? "now" : "todo";
        const inner = <><span className="sell-step-n" aria-hidden="true">{state === "done" ? <Icon name="check" size={14} /> : n}</span><span className="sell-step-label">{t(label)}</span></>;
        const link = state === "done" ? to(n) : null;
        return (
          <li key={label} className={state} aria-current={state === "now" ? "step" : undefined}>
            {link ? <Link to={link}>{inner}</Link> : <span>{inner}</span>}
          </li>
        );
      })}
    </ol>
  );
}
