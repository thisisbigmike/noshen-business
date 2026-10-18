import { Button, CheckedForm, ErrorText, TextField } from "@noshen/ui/ui";
import { addressProblem, coinName, networkOf, type Coin, type Network } from "@noshen/shared/payments";
import { useT } from "@noshen/ui/i18n";

/** The buyer's own address on a network, for refunds in that coin. Posts intent "refund" with coin, network and address. */
export function RefundAddressForm({ coin, network, defaultValue, submitLabel, error, busy }: {
  coin: Coin; network: Network; defaultValue?: string | null; submitLabel: string; error?: string | null; busy?: boolean;
}) {
  const t = useT();
  const c = coinName(coin);
  const n = networkOf(network);
  return (
    <CheckedForm method="post" className="stack" replace>
      <input type="hidden" name="intent" value="refund" />
      <input type="hidden" name="coin" value={coin} />
      <input type="hidden" name="network" value={network} />
      <TextField label={t("Your {coin} address on {network}", { coin: c, network: n.name })} name="address" className="mono-field" defaultValue={defaultValue ?? ""} required
        missing={addressProblem(coin, network, "") ?? undefined} validate={(v) => addressProblem(coin, network, v)}
        autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
        hint={t("Copy it from your wallet. For an exchange account, use the exchange's {coin} deposit address on {network}.", { coin: c, network: n.name })} />
      <ErrorText>{error}</ErrorText>
      <Button type="submit" variant="primary" block disabled={busy}>{busy ? t("Saving…") : submitLabel}</Button>
    </CheckedForm>
  );
}
