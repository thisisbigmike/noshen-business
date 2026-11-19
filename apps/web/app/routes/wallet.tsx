import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { renderSVG } from "uqr";
import type { Route } from "./+types/wallet";
import { requireUser, withApp, messageOf } from "../../server/web";
import {
  DAILY_WITHDRAWAL_MICRO,
  MIN_WITHDRAWAL_MICRO,
  depositAddresses,
  requestWithdrawal,
  sendWithdrawal,
  walletActivity,
  walletBalances,
} from "@noshen/engine/wallets";
import { coinAmount, coinName, networkOf, type Coin, type Network } from "@noshen/shared/payments";
import { ago } from "@noshen/shared/time";
import { Button, ErrorText, Icon, Info, Kv, Select, TextField, TopBar } from "@noshen/ui/ui";
import { CopyButton } from "../lib/copy-button";
import { useT } from "@noshen/ui/i18n";

export const handle = { tabs: false };
export const meta = () => [{ title: "Wallet · NosHen" }];

export async function loader({ request }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const enabled = !!d.wallets;
    if (!enabled) {
      return {
        enabled: false as const,
        balances: [],
        addresses: [],
        activity: [],
        minWithdrawalMicro: MIN_WITHDRAWAL_MICRO,
        dailyWithdrawalMicro: DAILY_WITHDRAWAL_MICRO,
      };
    }
    const [balances, rawAddresses, activity] = await Promise.all([
      walletBalances(d, user.id),
      depositAddresses(d, user.id),
      walletActivity(d, user.id, 25),
    ]);
    const addresses = rawAddresses.map((a) => ({
      ...a,
      qr: renderSVG(a.address, { ecc: "M", border: 2, pixelSize: 5, blackColor: "#000", whiteColor: "#fff" }),
    }));
    return {
      enabled: true as const,
      balances,
      addresses,
      activity,
      minWithdrawalMicro: MIN_WITHDRAWAL_MICRO,
      dailyWithdrawalMicro: DAILY_WITHDRAWAL_MICRO,
    };
  });
}

export async function action({ request }: Route.ActionArgs) {
  const f = await request.formData();
  const intent = String(f.get("intent") ?? "");
  if (intent !== "withdraw") return { error: "Unknown action." };
  try {
    const coin = String(f.get("coin") ?? "usdc") as Coin;
    const network = String(f.get("network") ?? "solana") as Network;
    const amountRaw = Number(String(f.get("amount") ?? "").replace(/[$,\s]/g, ""));
    const amountMicro = Math.round(amountRaw * 1_000_000);
    const toAddress = String(f.get("to_address") ?? "").trim();
    if (!Number.isFinite(amountRaw) || amountMicro < MIN_WITHDRAWAL_MICRO) {
      return { error: `Minimum withdrawal is ${coinAmount(MIN_WITHDRAWAL_MICRO, coin)}.` };
    }
    const id = await withApp(async (d) => {
      const user = await requireUser(request, d);
      const w = await requestWithdrawal(d, user.id, { coin, network, amountMicro, address: toAddress });
      await sendWithdrawal(d, w.id);
      return w.id;
    });
    return { ok: true, id };
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e) };
  }
}

export default function Wallet({ loaderData: x, actionData }: Route.ComponentProps) {
  const t = useT();
  const busy = useNavigation().state !== "idle";
  const [coin, setCoin] = useState<Coin>("usdc");
  const [network, setNetwork] = useState<Network>("solana");

  return (
    <div>
      <TopBar title={t("NosHen wallet")} back="/account" />
      <main className="page no-tabs stack-4">
        <div className="stack">
          <h1 className="heading desktop-only">{t("NosHen wallet")}</h1>
          <p className="body muted">{t("Hold USDT or USDC across Solana, Base and BNB Smart Chain for faster protected deals and withdrawals.")}</p>
        </div>

        {!x.enabled ? (
          <Info icon="wallet">
            {t("Multi-chain NosHen wallets are turning on soon on this site. You can still pay with USDT or USDC directly on any deal.")}
          </Info>
        ) : (
          <div className="two-col">
            <div className="stack-4">
              <section className="card stack">
                <p className="title">{t("Balances")}</p>
                {x.balances.length ? (
                  x.balances.map((b) => (
                    <Kv
                      key={`${b.coin}:${b.network}`}
                      k={`${coinName(b.coin)} · ${networkOf(b.network).name}`}
                      v={coinAmount(b.micro, b.coin)}
                    />
                  ))
                ) : (
                  <p className="caption muted">{t("No balance yet. Send USDT or USDC to one of your deposit addresses below.")}</p>
                )}
              </section>

              <section className="card stack-4">
                <div className="stack">
                  <p className="title">{t("Deposit addresses")}</p>
                  <p className="caption muted">{t("Send only USDT or USDC on the matching network. Sending another token or network cannot be recovered.")}</p>
                </div>
                {x.addresses.map((a) => (
                  <div key={a.network} className="card flat stack" style={{ gap: 10 }}>
                    <p className="label">{networkOf(a.network).name} ({a.coins.map((c) => coinName(c)).join(" / ")})</p>
                    <div className="row wrap" style={{ gap: 12, alignItems: "center" }}>
                      <span className="pay-qr" style={{ width: 96, height: 96 }} role="img" aria-label={t("QR code of the address")} dangerouslySetInnerHTML={{ __html: a.qr }} />
                      <div className="grow stack" style={{ gap: 8, minWidth: 0 }}>
                        <code className="caption" style={{ wordBreak: "break-all" }}>{a.address}</code>
                        <CopyButton text={a.address} label={t("Copy address")} />
                      </div>
                    </div>
                  </div>
                ))}
              </section>

              <section className="card stack">
                <p className="title">{t("Recent activity")}</p>
                {x.activity.length ? (
                  x.activity.map((item: any) => (
                    <div key={`${item.kind}:${item.id}`} className="kv" style={{ alignItems: "center" }}>
                      <span className="stack" style={{ gap: 0 }}>
                        <span className="body">
                          {item.kind === "deposit" ? t("Deposit") : t("Withdrawal")} · {networkOf(item.network).name}
                        </span>
                        <span className="caption muted">
                          {item.status ? `${item.status} · ` : ""}
                          {ago(item.at)}
                        </span>
                      </span>
                      <span className="label tabular">
                        {item.kind === "deposit" ? "+" : "-"}
                        {coinAmount(item.micro, item.coin)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="caption muted">{t("No wallet activity yet.")}</p>
                )}
              </section>
            </div>

            <aside className="side stack-4">
              <section className="card stack-4">
                <div className="stack">
                  <p className="title">{t("Withdraw")}</p>
                  <p className="caption muted">
                    {t("Minimum {min}, up to {max} per day. Every destination address is screened before sending.", {
                      min: coinAmount(x.minWithdrawalMicro, coin),
                      max: coinAmount(x.dailyWithdrawalMicro, coin),
                    })}
                  </p>
                </div>
                <Form method="post" className="stack">
                  <input type="hidden" name="intent" value="withdraw" />
                  <div className="row wrap" style={{ gap: 12 }}>
                    <div className="grow">
                      <Select
                        name="coin"
                        label={t("Coin")}
                        value={coin}
                        onChange={(v) => setCoin(v as Coin)}
                        options={[
                          { value: "usdc", label: "USDC" },
                          { value: "usdt", label: "USDT" },
                        ]}
                      />
                    </div>
                    <div className="grow">
                      <Select
                        name="network"
                        label={t("Network")}
                        value={network}
                        onChange={(v) => setNetwork(v as Network)}
                        options={[
                          { value: "solana", label: "Solana" },
                          { value: "base", label: "Base" },
                          { value: "bsc", label: "BNB Smart Chain" },
                        ]}
                      />
                    </div>
                  </div>
                  <TextField label={t("Amount ({coin})", { coin: coinName(coin) })} name="amount" type="number" step="0.01" min="1" placeholder="25.00" required />
                  <TextField label={t("Destination address")} name="to_address" placeholder={network === "solana" ? "Solana address" : "0x..."} autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
                  {actionData && "ok" in actionData ? (
                    <Info icon="circle-check">{t("Withdrawal started. We'll update the status below once the network confirms.")}</Info>
                  ) : null}
                  <ErrorText>{actionData && "error" in actionData ? actionData.error : null}</ErrorText>
                  <Button type="submit" variant="primary" icon="send" disabled={busy}>
                    {busy ? t("Sending…") : t("Send withdrawal")}
                  </Button>
                </Form>
              </section>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
