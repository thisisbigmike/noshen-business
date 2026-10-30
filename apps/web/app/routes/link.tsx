import { Form, useNavigation } from "react-router";
import type { Route } from "./+types/link";
import { requireUser, withApp, messageOf } from "../../server/web";
import { agentLinkOffer, confirmAgentLink } from "@noshen/engine/agent";
import { BottomAction, Button, ErrorText, Info, TopBar } from "@noshen/ui/ui";
import { useT } from "@noshen/ui/i18n";

export const handle = { tabs: false };
export const meta = () => [{ title: "Link Telegram · NosHen" }, { name: "robots", content: "noindex" }];

/**
 * Where a link sent by the NosHen assistant on Telegram lands: the signed-in person confirms that the chat may act
 * for their account. The link works once, for a few minutes.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    await requireUser(request, d);
    return { offer: await agentLinkOffer(d, params.code) };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  try {
    await withApp(async (d) => {
      const user = await requireUser(request, d);
      await confirmAgentLink(d, user.id, params.code);
    });
    return { done: true as const };
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e) };
  }
}

export default function Link({ loaderData: x, actionData }: Route.ComponentProps) {
  const t = useT();
  const busy = useNavigation().state !== "idle";
  if (actionData && "done" in actionData) {
    return (
      <div>
        <TopBar title={t("Telegram linked")} back="/account" />
        <main className="page narrow no-tabs stack-4">
          <h1 className="heading">{t("Telegram linked")}</h1>
          <Info icon="circle-check">{t("Go back to Telegram: the assistant now knows it's you.")}</Info>
          <Button to="/account">{t("Back to Account")}</Button>
        </main>
      </div>
    );
  }
  if (!x.offer) {
    return (
      <div>
        <TopBar title={t("Link Telegram")} back="/account" />
        <main className="page narrow no-tabs stack-4">
          <h1 className="heading">{t("This link has expired or was already used.")}</h1>
          <p className="body">{t("Send /link to the NosHen assistant on Telegram for a new one.")}</p>
          <Button to="/account">{t("Back to Account")}</Button>
        </main>
      </div>
    );
  }
  return (
    <Form method="post">
      <TopBar title={t("Link Telegram")} back="/account" />
      <main className="page narrow no-tabs stack-4">
        <h1 className="heading">{t("Link Telegram to your NosHen account?")}</h1>
        <section className="card stack">
          <p className="title">{x.offer.externalName ? t("{name} on Telegram", { name: x.offer.externalName }) : t("Your Telegram chat")}</p>
          <p className="body">{t("Once linked, the NosHen assistant can show your wallet balance and deposit addresses, and tell you where your deals stand.")}</p>
        </section>
        <Info icon="lock">{t("It can't move your money. Paying from the chat comes later, and you'll approve every payment there.")}</Info>
        <p className="caption muted">{t("You can unlink it any time in Account.")}</p>
        <ErrorText>{actionData && "error" in actionData ? actionData.error : null}</ErrorText>
        <BottomAction>
          <div className="stack">
            <Button type="submit" variant="primary" size="lg" block disabled={busy}>{busy ? t("Linking…") : t("Link Telegram")}</Button>
            <Button to="/account" block>{t("Not now")}</Button>
          </div>
        </BottomAction>
      </main>
    </Form>
  );
}
