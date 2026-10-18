// Jobs paid in stages on the customer site: the seller's stages (selling), the stages on a listing, and what each
// stage of a deal comes to.
import { useState } from "react";
import { Link } from "react-router";
import { Icon, Kv, TextField } from "@noshen/ui/ui";
import { useT } from "@noshen/ui/i18n";
import { naira } from "@noshen/shared/money";
import { DEFAULT_STAGES, MAX_STAGES, type Stage } from "@noshen/shared/stages";

/** A stage of a deal, as the deal page loads it. */
export interface DealStage { n: number; title: string; share_kobo: string | number; fee_kobo: string | number; done_at: string | Date | null; release_due_at: string | Date | null; released_at: string | Date | null; released_by?: string | null }

/**
 * What a stage comes to for each person: for the buyer, its part of the price; for the seller, what they get.
 * (When the seller pays the fee, the price is their share plus the fee.)
 */
export const stageAmount = (s: DealStage, role: "buyer" | "seller", feePayer: string) =>
  Number(s.share_kobo) + (role === "buyer" && feePayer === "seller" ? Number(s.fee_kobo) : 0);

/** The next stage to be released, if any. */
export const nextStage = (stages: DealStage[]) => stages.find((s) => !s.released_at) ?? null;

/** The seller's stages, when selling a job: a name and a share of the price for each, up to four. */
export function StageFields({ stages, priceKobo, confirmHours, error }: { stages: Stage[] | null; priceKobo: number; confirmHours: number; error?: string | null }) {
  const t = useT();
  const start = (stages?.length ? stages : DEFAULT_STAGES).map((s) => ({ title: stages?.length ? s.title : t(s.title), percent: String(s.percent) }));
  const [rows, setRows] = useState(start);
  const total = rows.reduce((n, r) => n + (Number(r.percent.replace(/[^\d]/g, "")) || 0), 0);
  const set = (i: number, k: "title" | "percent", v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <fieldset id="stages-field" className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="label" style={{ marginBottom: 8 }}>{t("Paid in stages")}</legend>
      <p className="caption muted">{t("The buyer pays the whole price into NosHen before you start. Each stage is paid to you when it's done and they've checked it, or by itself {hours} hours after you mark it done, if they don't report a problem.", { hours: confirmHours })}</p>
      {rows.map((r, i) => {
        const pct = Number(r.percent.replace(/[^\d]/g, "")) || 0;
        return (
          <div key={i} className="stage-row">
            <TextField label={t("Stage {n}", { n: i + 1 })} name={`stage_title_${i + 1}`} value={r.title} maxLength={60} required
              placeholder={i === 0 ? t("Work starts") : t("Work finished")} missing={t("Name stage {n}, like “Work starts”.", { n: i + 1 })}
              onChange={(e) => set(i, "title", e.target.value)} hint={priceKobo > 0 && pct ? t("{amount} of the price", { amount: naira(Math.round((priceKobo * pct) / 100)) }) : undefined} />
            <TextField label={t("Share (%)")} name={`stage_percent_${i + 1}`} inputMode="numeric" value={r.percent} required maxLength={3}
              missing={t("Each stage is at least 5% of the price.")} onChange={(e) => set(i, "percent", e.target.value.replace(/[^\d]/g, ""))} />
            {rows.length > 1 ? (
              <button type="button" className="icon-btn stage-remove" aria-label={t("Remove stage {n}", { n: i + 1 })} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="x" size={18} /></button>
            ) : <span className="stage-remove" aria-hidden="true" />}
          </div>
        );
      })}
      {error ? <p className="nh-field-msg nh-field-msg-error caption" role="alert"><Icon name="alert-triangle" size={16} />{error}</p>
        : <p className={`caption${total === 100 ? " muted" : ""}`}>{total === 100 ? t("Adds up to 100%.") : t("The stages add up to {total}%. Make them add up to 100%.", { total })}</p>}
      {rows.length < MAX_STAGES ? (
        <div><button type="button" className="link-btn stage-add" onClick={() => setRows([...rows, { title: "", percent: String(Math.max(0, 100 - total)) }])}>
          <Icon name="plus" size={16} /> {t("Add a stage")}
        </button></div>
      ) : null}
    </fieldset>
  );
}

/** The stages a job is paid in, on a listing, the seller's review and the buy page. No `seller`: the seller's own view. */
export function StagesCard({ stages, priceKobo, seller, editTo }: { stages: Stage[]; priceKobo: number; seller?: string; editTo?: string }) {
  const t = useT();
  return (
    <section className="card stack" aria-labelledby="stages-title">
      <div className="row-between"><h2 id="stages-title" className="title">{t("Paid in stages")}</h2>{editTo ? <Link to={editTo} className="caption tap">{t("Change")}</Link> : null}</div>
      <div>
        {stages.map((s, i) => (
          <Kv key={i} k={<span className="row" style={{ gap: 6 }}><span className="stage-n" aria-hidden="true">{i + 1}</span>{t(s.title)}</span>}
            v={`${s.percent}% · ${naira(Math.round((priceKobo * s.percent) / 100))}`} />
        ))}
      </div>
      <p className="caption muted">{seller
        ? t("You pay the whole price into NosHen first. {seller} is paid each stage only when you've checked the work and released it.", { seller })
        : t("The buyer pays the whole price into NosHen first. You're paid each stage when they've checked the work and released it.")}</p>
    </section>
  );
}
