import { Link } from "react-router";
import { Icon } from "@noshen/ui/ui";
import { USDT_NETWORKS, payPlanFor } from "@noshen/shared/payments";

/**
 * The ways to pay into a deal, in the order that suits the country the buyer's device is in (Cloudflare tells us,
 * from its connection): naira by bank transfer first in Nigeria, USDT first elsewhere.
 */
export function PayOptions({ dealId, country, usdtOn }: { dealId: string; country: string; usdtOn: boolean }) {
  const plan = payPlanFor(country, usdtOn);

  const bank = (
    <section className="stack" aria-labelledby="pay-naira">
      <h3 id="pay-naira" className="label muted">Naira</h3>
      <Link className="pay-option" to={`/d/${dealId}/pay/bank`}>
        <span className="pay-icon" aria-hidden="true"><Icon name="building-bank" size={22} /></span>
        <span className="grow stack" style={{ gap: 2 }}>
          <span className="row wrap" style={{ gap: 8 }}><span className="title">Bank transfer</span>{plan.bankFirst ? <span className="pay-tag caption">Recommended</span> : null}</span>
          <span className="caption muted">{plan.bankDetail}</span>
        </span>
        <Icon name="chevron-right" size={20} />
      </Link>
    </section>
  );

  const usdt = plan.usdt ? (
    <section className="stack" aria-labelledby="pay-usdt">
      <h3 id="pay-usdt" className="label muted">USDT (crypto)</h3>
      <div className="pay-list">
        {USDT_NETWORKS.map((n) => (
          <Link key={n.id} className="pay-option" to={`/d/${dealId}/pay/usdt/${n.id}`}>
            <span className={`pay-chain chain-${n.id}`} aria-hidden="true">{n.tag}</span>
            <span className="grow stack" style={{ gap: 2 }}>
              <span className="title">USDT on {n.name}</span>
              <span className="caption muted">{n.standard ? `${n.standard} · ` : ""}{n.fees}</span>
            </span>
            <Icon name="chevron-right" size={20} />
          </Link>
        ))}
      </div>
    </section>
  ) : null;

  return (
    <div className="stack-4">
      {plan.bankFirst ? <>{bank}{usdt}</> : <>{usdt}{bank}</>}
      {plan.soon ? <p className="caption muted row" style={{ gap: 8 }}><Icon name="clock" size={16} />{plan.soon}</p> : null}
    </div>
  );
}
