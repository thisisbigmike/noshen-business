import { useState } from "react";
import { Link } from "react-router";
import { Icon } from "@noshen/ui/ui";
import { naira } from "@noshen/shared/money";
import { COINS, NETWORKS, QUOTE_MINUTES, coinAmount, coinName, payPlanFor, type Coin } from "@noshen/shared/payments";
import { CoinLogo, CryptoLogo } from "./crypto-logo";

/** Roughly what the deal comes to in each coin (from cryptoQuotes), or null when there's no crypto partner. */
export type Quotes = { usdt: { micro: number; rateKobo: number }; usdc: { micro: number; rateKobo: number }; test: boolean } | null;

/**
 * The ways to pay into a deal, in the order that suits the country the buyer's device is in (Cloudflare tells us,
 * from its connection): naira by bank transfer first in Nigeria, stablecoins first elsewhere. For stablecoins the
 * buyer picks USDT or USDC, sees about how much that is, then picks the network.
 */
export function PayOptions({ dealId, country, quotes }: { dealId: string; country: string; quotes: Quotes }) {
  const plan = payPlanFor(country, !!quotes);
  const [coin, setCoin] = useState<Coin>("usdt");

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

  const q = quotes?.[coin];
  const crypto = quotes && q ? (
    <section className="stack" aria-labelledby="pay-crypto">
      <div className="row-between wrap" style={{ alignItems: "center", gap: 8 }}>
        <h3 id="pay-crypto" className="label muted">Crypto</h3>
        <div className="coin-switch" role="group" aria-label="Coin to pay with">
          {COINS.map((c) => (
            <button key={c.id} type="button" aria-pressed={coin === c.id} onClick={() => setCoin(c.id)}>
              <CoinLogo coin={c.id} size={24} />{c.name}
            </button>
          ))}
        </div>
      </div>
      <p className="pay-quote" aria-live="polite">
        <span className="title tabular">About {coinAmount(q.micro, coin)}</span>
        <span className="caption muted">{naira(q.rateKobo)} per {coinName(coin)}{quotes.test ? " (test rate)" : ""}. The exact amount is fixed for {QUOTE_MINUTES} minutes when you pick a network.</span>
      </p>
      <div className="pay-list">
        {NETWORKS.map((n) => (
          <Link key={n.id} className="pay-option" to={`/d/${dealId}/pay/${coin}/${n.id}`}>
            <CryptoLogo coin={coin} network={n.id} />
            <span className="grow stack" style={{ gap: 2 }}>
              <span className="title">{coinName(coin)} on {n.name}</span>
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
      {plan.bankFirst ? <>{bank}{crypto}</> : <>{crypto}{bank}</>}
      {plan.soon ? <p className="caption muted row" style={{ gap: 8 }}><Icon name="clock" size={16} />{plan.soon}</p> : null}
    </div>
  );
}
