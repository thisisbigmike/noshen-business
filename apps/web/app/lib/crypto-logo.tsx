import type { Coin, Network } from "@noshen/shared/payments";
// The real logos (see assets/logos/NOTICE.md). Each is under 2KB, so Vite puts them in the page: no wait, no flash.
import usdt from "../assets/logos/usdt.svg";
import usdc from "../assets/logos/usdc.svg";
import solana from "../assets/logos/solana.svg";
import bsc from "../assets/logos/bsc.svg";
import base from "../assets/logos/base.svg";

const COIN: Record<Coin, string> = { usdt, usdc };
const NETWORK: Record<Network, string> = { solana, bsc, base };

export const CoinLogo = ({ coin, size = 20 }: { coin: Coin; size?: number }) => (
  <img className="coin-logo" src={COIN[coin]} alt="" width={size} height={size} aria-hidden="true" />
);

/**
 * A coin on a network, as wallets show it: one logo large, the other small in its corner. In the list of networks
 * the network leads (that's the choice being made); on the pay screen the coin does.
 */
export function CryptoLogo({ coin, network, size = 40, lead = "network" }: { coin: Coin; network: Network; size?: number; lead?: "network" | "coin" }) {
  const [big, small] = lead === "network" ? [NETWORK[network], COIN[coin]] : [COIN[coin], NETWORK[network]];
  const badge = Math.round(size * 0.45);
  return (
    <span className={`crypto-logo lead-${lead}`} style={{ width: size, height: size }} aria-hidden="true">
      <img src={big} alt="" width={size} height={size} />
      <img className="badge" src={small} alt="" width={badge} height={badge} />
    </span>
  );
}
