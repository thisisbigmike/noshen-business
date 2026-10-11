import { Button, CheckedForm, ErrorText, TextField } from "@noshen/ui/ui";
import { addressProblem, coinName, networkOf, type Coin, type Network } from "@noshen/shared/payments";

/** The buyer's own address on a network, for refunds in that coin. Posts intent "refund" with coin, network and address. */
export function RefundAddressForm({ coin, network, defaultValue, submitLabel, error, busy }: {
  coin: Coin; network: Network; defaultValue?: string | null; submitLabel: string; error?: string | null; busy?: boolean;
}) {
  const c = coinName(coin);
  const n = networkOf(network);
  return (
    <CheckedForm method="post" className="stack" replace>
      <input type="hidden" name="intent" value="refund" />
      <input type="hidden" name="coin" value={coin} />
      <input type="hidden" name="network" value={network} />
      <TextField label={`Your ${c} address on ${n.name}`} name="address" className="mono-field" defaultValue={defaultValue ?? ""} required
        missing={addressProblem(coin, network, "") ?? undefined} validate={(v) => addressProblem(coin, network, v)}
        autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
        hint={`Copy it from your wallet. For an exchange account, use the exchange's ${c} deposit address on ${n.name}.`} />
      <ErrorText>{error}</ErrorText>
      <Button type="submit" variant="primary" block disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
    </CheckedForm>
  );
}
