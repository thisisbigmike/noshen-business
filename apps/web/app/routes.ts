import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  layout("routes/_app.tsx", [
    index("routes/landing.tsx"),
    route("browse", "routes/browse.tsx"),
    route("l/:id", "routes/listing.tsx"),
    route("l/:id/buy", "routes/buy.tsx"),
    route("deals", "routes/deals.tsx"),
    route("d/:id", "routes/deal.tsx"),
    route("d/:id/pay", "routes/pay.tsx"),
    route("d/:id/pay/bank", "routes/pay-bank.tsx"),
    route("d/:id/pay/:coin/:network", "routes/pay-crypto.tsx"),
    route("d/:id/code", "routes/release-code.tsx"),
    route("d/:id/enter-code", "routes/enter-code.tsx"),
    route("d/:id/report", "routes/report.tsx"),
    route("d/:id/evidence", "routes/evidence.tsx"),
    route("sell", "routes/sell.tsx"),
    route("sell/:id/details", "routes/sell-details.tsx"),
    route("sell/:id/share", "routes/sell-share.tsx"),
    route("account", "routes/account.tsx"),
    route("account/verify", "routes/verify.tsx"),
    route("notifications", "routes/notifications.tsx"),
    route("signin", "routes/signin.tsx"),
    route("signout", "routes/signout.tsx"),
    // Legal and help pages: one module, one route per document.
    ...["terms", "deal-terms", "privacy", "cookies", "prohibited-items", "safety"].map((slug) => route(slug, "routes/legal.tsx", { id: `legal-${slug}` })),
  ]),
] satisfies RouteConfig;
