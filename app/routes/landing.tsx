import { Link } from "react-router";
import type { Route } from "./+types/landing";
import { optionalUser, withApp } from "../../server/web";
import { settingsOf } from "../../server/engine/core";
import { one } from "../../server/db";
import { Button, DealCard, Icon, ProtectionBadge, ReleaseCode, Wordmark } from "../components/ui";
import type { IconName } from "../components/icons";
import { feeFor, naira } from "../../shared/money";

export const handle = { tabs: false };

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const title = "NosHen: buy and sell phones and laptops in Lagos, protected";
  const desc = "Your money is held by a licensed partner bank until you have the item. The seller is paid when you give them your release code.";
  return [
    { title },
    { name: "description", content: desc },
    { property: "og:title", content: "NosHen: your money is held until you have the item" },
    { property: "og:description", content: desc },
    { property: "og:type", content: "website" },
    ...(loaderData ? [{ property: "og:url", content: loaderData.origin }] : []),
  ];
};

export async function loader({ request }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const s = await settingsOf(d);
    const live = await one<{ n: string }>(d.db, "select count(*) as n from listings where status = 'live'");
    const user = await optionalUser(request, d);
    return { fee: s.fee, live: Number(live?.n ?? 0), signedIn: !!user, origin: new URL(request.url).origin };
  });
}

const STEPS: [IconName, string, string][] = [
  ["building-bank", "You pay NosHen", "Transfer to a deal account at our licensed partner bank, only after the seller accepts."],
  ["lock", "The money is held", "The seller can see it's there, but can't touch it."],
  ["eye", "You check the item", "Meet in a public place, or get it delivered. Make sure it's what you paid for."],
  ["circle-check", "The seller is paid", "Give the seller your 6-digit release code, or confirm the delivery. The payout starts within minutes."],
];

const FAQ: [string, string][] = [
  ["Is NosHen a bank?", "No. A licensed partner bank holds the money. NosHen runs the deal steps and tells the bank where the money goes, and keeps a record of every naira."],
  ["What if the seller never shows up?", "If the hand-over hasn't happened within 72 hours of your payment, cancel the deal and get everything back, fee included."],
  ["What if the phone is fake, faulty or locked?", "Don't give your code. Report a problem in the app and the money stays frozen. You both add photos or notes, and a NosHen reviewer decides within 72 hours and tells you both why."],
  ["Can I pay the seller directly to save the fee?", "You can, but that money isn't protected. If something goes wrong, NosHen can't get it back for you."],
  ["How do sellers get paid?", "To a bank account in their own name, checked against their NIN or BVN. The payout starts within minutes of the release code."],
  ["What can I buy and sell?", "Used phones and laptops in Lagos, from ₦20,000 to ₦2,000,000. More categories and cities will follow."],
];

export default function Landing({ loaderData: x }: Route.ComponentProps) {
  const example = 45_000_000; // ₦450,000
  const fee = feeFor(example, x.fee);
  return (
    <div className="landing">
      <header className="landing-top mobile-only">
        <Link to="/" aria-label="NosHen home" style={{ textDecoration: "none" }}><Wordmark /></Link>
        <nav className="row">
          <Link to="/browse" className="label">Browse</Link>
          <Link to={x.signedIn ? "/deals" : "/signin"} className="label">{x.signedIn ? "Deals" : "Sign in"}</Link>
        </nav>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <ProtectionBadge>Protected by NosHen</ProtectionBadge>
          <h1 id="hero-title" className="hero-title">Your money is held until you have the item.</h1>
          <p className="hero-sub">NosHen is the safe way to buy and sell used phones and laptops in Lagos. You pay NosHen, a licensed partner bank holds the money, and the seller is paid only when you've checked the item and you're happy.</p>
          <div className="hero-ctas">
            <Button variant="primary" size="lg" to="/browse" icon="search">Browse phones and laptops</Button>
            <Button size="lg" to="/sell" icon="plus">Sell with protection</Button>
          </div>
          <p className="caption muted">You pay nothing until the seller accepts. Fee: {x.fee.percent}%, from {naira(x.fee.min_kobo)} to {naira(x.fee.max_kobo)}.{x.live ? ` ${x.live} listings for sale now.` : ""}</p>
        </div>
        <div className="hero-visual" aria-label="Example: a deal with the money held">
          <div className="phone-frame">
            <div className="phone-screen stack">
              <p className="label muted">Deal with Tunde</p>
              <DealCard state="held" word="Held" amountKobo={45_675_000} item="iPhone 13, 128GB" counterpart="Tunde · Meet-up"
                deadline="Meet by Fri 6pm" nextStep="Meet in a public place. Check the phone, then give Tunde your code." />
              <ReleaseCode code="482913" defaultRevealed help="Tunde types this code in at the hand-over. Never send it by chat, SMS or a call." />
            </div>
          </div>
        </div>
      </section>

      <section className="band" aria-labelledby="problem-title">
        <div className="band-inner stack-6">
          <div className="stack section-head">
            <h2 id="problem-title" className="heading">Nobody wants to go first</h2>
            <p className="body muted">Online deals between strangers in Lagos fall apart at the payment. Someone has to take the risk.</p>
          </div>
          <div className="cards-3">
            <div className="card stack"><Icon name="alert-triangle" /><p className="title">Pay first</p><p className="body muted">The seller disappears, or sends a fake or a different phone.</p></div>
            <div className="card stack"><Icon name="cash" /><p className="title">Hand over first</p><p className="body muted">The "payment" turns out to be a fake transfer alert.</p></div>
            <div className="card stack"><Icon name="map-pin" /><p className="title">Meet with cash</p><p className="body muted">You carry {naira(example)} across Lagos to meet a stranger.</p></div>
          </div>
          <p className="title">NosHen takes the risk out of the first step: the money waits in the middle.</p>
        </div>
      </section>

      <section className="band plain" aria-labelledby="how-title">
        <div className="band-inner stack-6">
          <div className="stack section-head"><h2 id="how-title" className="heading">How it works</h2><p className="body muted">Four steps, the same for every deal.</p></div>
          <ol className="steps-row">
            {STEPS.map(([icon, title, body], i) => (
              <li key={title} className="card stack">
                <div className="row-between"><span className="step-n">{i + 1}</span><Icon name={icon} /></div>
                <p className="title">{title}</p>
                <p className="body muted">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="band" aria-labelledby="code-title">
        <div className="band-inner split">
          <div className="stack-4">
            <h2 id="code-title" className="heading">At the meet-up, your code moves the money</h2>
            <p className="body">Your 6-digit release code is only in your NosHen app, never in an SMS. Before you show it, check three things:</p>
            <ul className="ticks">
              <li><Icon name="check" size={18} />It switches on and works.</li>
              <li><Icon name="check" size={18} />It isn't locked to someone else's account.</li>
              <li><Icon name="check" size={18} />The IMEI matches the listing. Dial *#06# to see it.</li>
            </ul>
            <p className="body muted">Happy? Read out your code and the seller types it in. Not happy? Keep your code and report a problem. The money stays held.</p>
          </div>
          <div className="code-demo"><ReleaseCode code="519358" help="Give this code to the seller only after you have checked the item. It releases your money." /></div>
        </div>
      </section>

      <section className="band plain" aria-labelledby="who-title">
        <div className="band-inner stack-6">
          <h2 id="who-title" className="heading section-head">Safer for both sides</h2>
          <div className="split">
            <div className="card stack-4">
              <div className="row"><Icon name="shield-check" /><h3 className="title">For buyers</h3></div>
              <p className="heading">No more paying first and hoping.</p>
              <ul className="ticks">
                <li><Icon name="check" size={18} />Your money is held until you have the item.</li>
                <li><Icon name="check" size={18} />Something wrong? Report it before you give your code, and the money stays frozen.</li>
                <li><Icon name="check" size={18} />No cash to carry to a meet-up.</li>
                <li><Icon name="check" size={18} />Sellers are ID-checked before they can be paid.</li>
              </ul>
              <Button variant="primary" to="/browse">Browse listings</Button>
            </div>
            <div className="card stack-4">
              <div className="row"><Icon name="building-bank" /><h3 className="title">For sellers</h3></div>
              <p className="heading">Know the money is real before you hand over.</p>
              <ul className="ticks">
                <li><Icon name="check" size={18} />NosHen shows you the money is held. No more fake alerts.</li>
                <li><Icon name="check" size={18} />Paid to your bank account within minutes of the code.</li>
                <li><Icon name="check" size={18} />One link for WhatsApp, Facebook and Instagram, with "Protected by NosHen" on it.</li>
                <li><Icon name="check" size={18} />Buyers say yes faster when their money is safe.</li>
              </ul>
              <Button variant="primary" to="/sell">Start selling</Button>
            </div>
          </div>
        </div>
      </section>

      <section className="band" aria-labelledby="wrong-title">
        <div className="band-inner split">
          <div className="stack-4">
            <h2 id="wrong-title" className="heading">If something goes wrong</h2>
            <ol className="numbered">
              <li><strong>Report a problem</strong> in the app before you give your code or confirm delivery. The money freezes at once.</li>
              <li><strong>Both of you add photos or notes</strong> within 24 hours.</li>
              <li><strong>A NosHen reviewer decides</strong> within 72 hours: refund the buyer in full, or release the money to the seller. You both get the reason.</li>
            </ol>
            <p className="body muted">If the seller doesn't hand over within 72 hours of your payment, you can cancel and get everything back, fee included.</p>
          </div>
          <div className="card stack-4 fee-card">
            <h2 className="heading">What it costs</h2>
            <p className="body">{x.fee.percent}% of the price, at least {naira(x.fee.min_kobo)} and at most {naira(x.fee.max_kobo)}. The buyer pays it, unless the seller offers to.</p>
            <div>
              <div className="kv"><span className="muted">A phone for</span><span className="tabular">{naira(example)}</span></div>
              <div className="kv"><span className="muted">NosHen fee</span><span className="tabular">{naira(fee)}</span></div>
              <div className="kv total"><span>The buyer pays</span><span className="tabular">{naira(example + fee)}</span></div>
            </div>
            <p className="caption muted">Listing and browsing are free. You pay nothing until the seller accepts.</p>
          </div>
        </div>
      </section>

      <section className="band plain" aria-labelledby="faq-title">
        <div className="band-inner stack-4 faq">
          <h2 id="faq-title" className="heading">Questions</h2>
          {FAQ.map(([q, a]) => (
            <details key={q} className="card">
              <summary className="title">{q}</summary>
              <p className="body muted">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="band final" aria-labelledby="final-title">
        <div className="band-inner stack-4" style={{ alignItems: "center", textAlign: "center" }}>
          <h2 id="final-title" className="hero-title" style={{ fontSize: 32, lineHeight: "38px" }}>Your next phone deal, protected.</h2>
          <div className="hero-ctas" style={{ justifyContent: "center" }}>
            <Button variant="primary" size="lg" to="/browse">Browse phones and laptops</Button>
            <Button size="lg" to="/sell">Sell with protection</Button>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="band-inner row-between wrap">
          <div className="stack"><Wordmark size="sm" /><p className="caption muted">Your money is held until you have the item. Lagos, Nigeria.</p></div>
          <nav className="row wrap" aria-label="Footer">
            <Link to="/browse" className="caption">Browse</Link>
            <Link to="/sell" className="caption">Sell</Link>
            <Link to={x.signedIn ? "/account" : "/signin"} className="caption">{x.signedIn ? "Account" : "Sign in"}</Link>
          </nav>
          <p className="caption muted">© {new Date().getFullYear()} NosHen</p>
        </div>
      </footer>
    </div>
  );
}
