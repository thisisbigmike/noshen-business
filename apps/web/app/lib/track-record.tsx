// A person's track record, from their deals on NosHen: shown to buyers on listings and on a seller's shop, and to a
// seller about the buyer asking them.
import { Link } from "react-router";
import { Avatar, Icon, TrustBadge } from "@noshen/ui/ui";
import { useT } from "@noshen/ui/i18n";
import { firstName } from "@noshen/shared/deal";
import { monthYear, replyTime, trustLevel } from "@noshen/shared/trust";
import type { SellerSummary } from "@noshen/engine/queries";

type Person = Omit<SellerSummary, "memberSince"> & { memberSince: string | Date };

/** The trust badge with its words: "Trusted seller", "Building a track record" or "New seller". */
export function TrustChip({ person }: { person: Person }) {
  const t = useT();
  const level = trustLevel(person);
  return (
    <span className={`trust-chip trust-${level} label`}>
      <TrustBadge level={level} size={20} />
      {level === "trusted" ? t("Trusted seller") : level === "building" ? t("Building a track record") : t("New seller")}
    </span>
  );
}

/** The seller card on a listing or shop: who they are, then what their deals show. */
export function SellerRecord({ person, area, shop }: { person: Person; area?: string; shop?: boolean }) {
  const t = useT();
  const name = firstName(person.name);
  const reply = replyTime(person.replyMinutes, t);
  return (
    <section className="card stack-4" aria-label={t("Seller")}>
      <div className="row">
        <Avatar name={person.name} photo={person.photo} />
        <div className="grow stack" style={{ gap: 4, alignItems: "flex-start" }}>
          <p className="title">{name}</p>
          <TrustChip person={person} />
          <p className="caption muted">{area ? `${t("Seller in {place}", { place: area })} · ` : ""}{t("On NosHen since {date}", { date: monthYear(person.memberSince) })}</p>
        </div>
      </div>
      <div className="stats stats-4">
        <div className="stat"><p className="label">{person.completedDeals}</p><p className="caption muted">{t("Sales completed")}</p></div>
        <div className="stat"><p className="label">{person.problemFree === null ? "—" : `${person.problemFree}%`}</p><p className="caption muted">{t("Without a problem")}</p></div>
        <div className="stat"><p className="label">{person.rating ?? t("New")}</p><p className="caption muted">{person.ratingCount ? t("Rating, from {n}", { n: person.ratingCount }) : t("Rating")}</p></div>
        <div className="stat"><p className="label">{reply ?? "—"}</p><p className="caption muted">{t("Answers requests")}</p></div>
      </div>
      <p className="caption muted row" style={{ gap: 6 }}>
        <Icon name={person.idVerified ? "circle-check" : "info-circle"} size={16} />
        {person.idVerified ? t("ID checked by NosHen. Every number above comes from real deals on NosHen.") : t("ID not checked yet. Every number above comes from real deals on NosHen.")}
      </p>
      {shop ? null : <Link to={`/s/${person.id}`} className="label row tap">{t("See everything {name} sells", { name })}<Icon name="arrow-right" size={16} /></Link>}
    </section>
  );
}

/** For a seller looking at a buy request: what the buyer's own deals show. */
export function BuyerRecord({ person }: { person: Person }) {
  const t = useT();
  return (
    <p className="caption muted row" style={{ gap: 6 }}>
      <Icon name={person.idVerified ? "circle-check" : "user"} size={16} />
      {t("{name}: {n} purchases completed on NosHen, here since {date}.", { name: firstName(person.name), n: person.purchases, date: monthYear(person.memberSince) })}
      {person.idVerified ? ` ${t("ID checked.")}` : ""}
    </p>
  );
}
